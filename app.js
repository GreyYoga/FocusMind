document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Глобальное Состояние ---
    let wizardSubcategories = [];
    let currentStep = 0;
    let allTasks = []; // Локальная копия для быстрого рендеринга
    // let nextTaskId = 1; // (УДАЛЕНО: IndexedDB сама генерирует ID)
    let currentDate = new Date();
    const todayStr = new Date().toISOString().slice(0, 10);

    // Переменные для базы данных
    let db;
    const DB_NAME = 'SecretaryDB';
    const STORE_NAME = 'tasks';

    // Состояние Таймера
    const timerModes = {
        pomodoro: 25 * 60,
        shortBreak: 5 * 60,
        longBreak: 15 * 60
    };
    let currentTimerMode = 'pomodoro';
    let remainingTime = timerModes.pomodoro;
    let isTimerRunning = false;
    let timerInterval = null;
    let activeFocusTaskId = null;

    const priorities = [
        { value: "1", text: "Важно / Срочно" },
        { value: "2", text: "Важно / Не срочно" },
        { value: "3", text: "Не важно / Срочно" },
        { value: "4", text: "Не важно / Не срочно" }
    ];
    const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

    // --- 2. Элементы DOM (те же самые) ---
    const appContainer = document.querySelector('.container');
    const screens = {
        inbox: document.getElementById('inbox-screen'),
        plan: document.getElementById('plan-screen'),
        calendar: document.getElementById('calendar-screen'),
        wizard: document.getElementById('wizard-screen'),
        focus: document.getElementById('focus-screen')
    };
    const navButtons = {
        inbox: document.getElementById('nav-inbox'),
        plan: document.getElementById('nav-plan'),
        calendar: document.getElementById('nav-calendar'),
        wizard: document.getElementById('nav-wizard'),
        focus: document.getElementById('nav-focus')
    };
    const wizardElements = {
        categoryTitle: document.getElementById('category-title'),
        subcategoryTitle: document.getElementById('subcategory-title'),
        triggersList: document.getElementById('triggers-list'),
        form: document.getElementById('wizard-task-form'),
        taskInput: document.getElementById('wizard-task-input'),
        taskDate: document.getElementById('wizard-task-datetime'),
        stepTasksList: document.getElementById('wizard-step-tasks'),
        stepCounter: document.getElementById('step-counter'),
        prevBtn: document.getElementById('prev-btn'),
        nextBtn: document.getElementById('next-btn')
    };
    const calendarNavButtons = {
        prevMonth: document.getElementById('prev-month-btn'),
        nextMonth: document.getElementById('next-month-btn')
    };
    const inboxElements = {
        form: document.getElementById('add-task-form-inbox'),
        input: document.getElementById('new-task-input'),
        list: document.getElementById('inbox-list')
    };
    const planElements = {
        list: document.getElementById('plan-list')
    };
    const calendarElements = {
        title: document.getElementById('month-year-title'),
        grid: document.getElementById('calendar-grid'),
        listTitle: document.getElementById('calendar-list-title'),
        taskList: document.getElementById('calendar-task-list')
    };
    const focusElements = {
        timerDisplay: document.getElementById('timer-display'),
        startPauseBtn: document.getElementById('timer-start-pause'),
        resetBtn: document.getElementById('timer-reset'),
        btnPomodoro: document.getElementById('timer-btn-pomodoro'),
        btnShortBreak: document.getElementById('timer-btn-short-break'),
        btnLongBreak: document.getElementById('timer-btn-long-break'),
        modeButtonsContainer: document.getElementById('timer-mode-buttons'),
        list: document.getElementById('focus-list'),
        taskDisplay: document.getElementById('focus-task-display'),
        alarmSound: document.getElementById('alarm-sound')
    };

    // --- 3. INDEXED DB (База данных) ---

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);

            request.onerror = (event) => {
                console.error("Ошибка базы данных:", event.target.error);
                reject(event.target.error);
            };

            request.onupgradeneeded = (event) => {
                db = event.target.result;
                // Создаем хранилище объектов, keyPath 'id' с авто-инкрементом
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
        });
    }

    function loadTasksFromDB() {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            allTasks = request.result || [];
            renderAllLists();
        };
    }

    function addTaskToDB(task) {
        // Удаляем ID перед добавлением, чтобы DB сама его создала
        const { id, ...taskWithoutId } = task;
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(taskWithoutId);

        request.onsuccess = (event) => {
            // Получаем присвоенный ID и обновляем локальный массив
            task.id = event.target.result;
            allTasks.push(task);
            renderAllLists();
        };
    }

    function updateTaskInDB(task) {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(task); // put обновит запись по ID
        // Локальный массив обновляем сразу (оптимистичный UI)
        const index = allTasks.findIndex(t => t.id === task.id);
        if (index !== -1) allTasks[index] = task;
        renderAllLists();
    }

    function deleteTaskFromDB(id) {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete(id);

        allTasks = allTasks.filter(t => t.id !== id);
        renderAllLists();
    }

    // --- 4. УВЕДОМЛЕНИЯ (Notifications API) ---

    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission();
        }
    }

    function sendNotification(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            // Проверка для мобильных устройств - используем ServiceWorker регистрацию если доступна
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(registration => {
                    registration.showNotification(title, {
                        body: body,
                        icon: 'icon-192.png',
                        vibrate: [200, 100, 200]
                    });
                });
            } else {
                // Фолбэк для десктопа
                new Notification(title, { body: body, icon: 'icon-192.png' });
            }
        }
    }

    // --- 5. Вспомогательные Функции ---

    function createPrioritySelect(selectedPriority = "4") {
        const prioritySelect = document.createElement('select');
        prioritySelect.className = 'priority-select';
        prioritySelect.dataset.priority = selectedPriority;
        priorities.forEach(p => {
            prioritySelect.innerHTML += `<option value="${p.value}" ${p.value === selectedPriority ? 'selected' : ''}>${p.text}</option>`;
        });
        prioritySelect.addEventListener('change', (e) => {
            e.target.dataset.priority = e.target.value;
        });
        return prioritySelect;
    }

    function initializeWizardData() {
        // (Используем полные данные из прошлых версий, сокращено для краткости)
        const data = [
            {
                "category": "Учеба",
                "subcategories": [
                    { "name": "Домашнее задание", "triggers": ["Сделать", "Проверить", "Списать", "Передать"] },
                    { "name": "Лекции / семинары", "triggers": ["Взять конспект", "Записаться"] },
                    { "name": "Экзамены / зачеты", "triggers": ["Список вопросов", "Список литературы", "подготовиться"] },
                    { "name": "Диплом / Курсовая", "triggers": ["Тема", "Рецензент", "Научрук"] },
                    { "name": "Статьи / Конференции", "triggers": ["предложения", "встречи"] },
                    { "name": "Практика", "triggers": ["-"] }
                ]
            },
            {
                "category": "Работа",
                "subcategories": [
                    { "name": "Проекты", "triggers": ["начатые проекты", "проекты, которые надо начать", "проекты, которые хорошо бы начать"] },
                    { "name": "Обещания (Работа)", "triggers": ["начальник", "партнеры", "коллеги", "подчиненные", "клиенты"] },
                    { "name": "Документы", "triggers": ["отчеты / таймшиты", "оценки", "обзоры", "редактирование", "вычитка"] },
                    { "name": "Ожидания (Работа)", "triggers": ["информация", "проектные мероприятия", "ответы", "письма", "звонки"] },
                    { "name": "Проф. рост", "triggers": ["обучение", "семинары", "ориентиры", "чему стоит поучиться", "нужные навыки"] },
                    { "name": "Исследования", "triggers": ["-"] },
                    { "name": "Профессиональный гардероб", "triggers": ["-"] }
                ]
            },
            {
                "category": "Личное",
                "subcategories": [
                    { "name": "Обещания (Личные)", "triggers": ["жене/мужу", "детям", "родителям", "друзьям", "родственникам"] },
                    { "name": "Коммуникации", "triggers": ["звонки", "письма", "соц. сети", "напоминания"] },
                    { "name": "Встречи", "triggers": ["назначить", "отменить", "посетить"] },
                    { "name": "Предметы (взять/вернуть)", "triggers": ["предметы, взятые попользоваться", "инструменты", "книги/журналы", "деньги"] },
                    { "name": "Путешествия", "triggers": ["поездки на выходные", "информация", "друзьям", "семье"] },
                    { "name": "События", "triggers": ["торжества", "дни рождения"] },
                    { "name": "Административная сфера", "triggers": ["финансы", "оплата счетов", "банки", "кредиты / платежи", "налоги", "страховки", "правовые вопросы", "завещания", "доверенности"] },
                    { "name": "Ожидания (Личное)", "triggers": ["заказы по интернету/почте", "ремонт", "ответ на письма", "ответный звонок"] },
                    { "name": "Дом", "triggers": ["отопление", "кондиционирование", "водопровод/канализация", "ремонт", "электричество", "мебель", "коммунальные службы", "платежи", "кухня", "санузел", "места для уборки (гараж, кладовка)"] },
                    { "name": "Оборудование", "triggers": ["компьютер", "телевизор", "интернет"] },
                    { "name": "Машина", "triggers": ["гараж", "страховка", "ремонт", "ТО", "Шины / колеса"] },
                    { "name": "Гардероб", "triggers": ["свой", "супруги/супруга", "детей"] },
                    { "name": "Здоровье", "triggers": ["фитнес", "стоматология", "посещения врача", "лекарства", "диета/питание"] },
                    { "name": "Личное развитие", "triggers": ["семинары", "курсы", "самообразование", "статьи"] },
                    { "name": "Домашние животные", "triggers": ["прививки", "корм", "оборудование"] },
                    { "name": "Сообщество", "triggers": ["соседи", "школа", "детский сад", "церковь"] }
                ]
            }
        ];
        // В реальном проекте вставьте сюда полный массив из v8.2!

        wizardSubcategories = [];
        data.forEach(category => {
            category.subcategories.forEach(subcategory => {
                wizardSubcategories.push({
                    category: category.category,
                    name: subcategory.name,
                    triggers: subcategory.triggers
                });
            });
        });

        const oldPrioritySelect = wizardElements.form.querySelector('.priority-select');
        if (oldPrioritySelect) oldPrioritySelect.remove();
        const newPrioritySelect = createPrioritySelect("4");
        wizardElements.taskInput.after(newPrioritySelect);
    }

    // --- 6. Логика UI ---

    function showScreen(screenName) {
        Object.values(screens).forEach(screen => screen.style.display = 'none');
        Object.values(navButtons).forEach(btn => btn.classList.remove('active'));

        if (screens[screenName]) screens[screenName].style.display = 'block';
        if (navButtons[screenName]) navButtons[screenName].classList.add('active');

        if (screenName === 'inbox') renderInboxList();
        if (screenName === 'plan') renderPlanList();
        if (screenName === 'calendar') {
            renderCalendar();
            const formattedDate = new Date(todayStr + 'T00:00:00').toLocaleDateString('ru-RU');
            renderCalendarTaskList(todayStr, `Задачи на ${formattedDate} (Сегодня)`);
        }
        if (screenName === 'wizard') {
            initializeWizardData();
            showWizardStep(0);
        }
        if (screenName === 'focus') {
            renderFocusList();
        }
    }

    // --- Функции Управления Задачами (Обертки для DB) ---
    function addTask(text, priority = "4", date = "") {
        const newTask = {
            text: text.trim(),
            priority: priority,
            date: date,
            completed: false
        };
        addTaskToDB(newTask);
    }

    function updateTask(id, newValues) {
        const task = allTasks.find(t => t.id === id);
        if (task) {
            const updatedTask = { ...task, ...newValues };
            updateTaskInDB(updatedTask);
        }
    }

    function deleteTask(id) {
        deleteTaskFromDB(id);
    }

    function getTasksForDay(dateStr) {
        return allTasks.filter(t => t.date && t.date.startsWith(dateStr));
    }

    // --- Функции Таймера ---
    function updateTimerDisplay() {
        const minutes = Math.floor(remainingTime / 60);
        const seconds = remainingTime % 60;
        focusElements.timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        document.title = `${focusElements.timerDisplay.textContent} - Фокус`;
    }

    function setTimerMode(mode) {
        if (isTimerRunning) {
            if (!confirm('Сбросить таймер?')) return;
        }
        pauseTimer();
        currentTimerMode = mode;
        remainingTime = timerModes[mode];

        focusElements.modeButtonsContainer.querySelectorAll('.timer-mode-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`timer-btn-${mode.replace('B', '-b')}`).classList.add('active');
        updateTimerDisplay();
    }

    function startTimer() {
        // Запрашиваем разрешение на уведомления при первом старте
        requestNotificationPermission();

        isTimerRunning = true;
        focusElements.startPauseBtn.textContent = 'Пауза';

        timerInterval = setInterval(() => {
            remainingTime--;
            updateTimerDisplay();

            if (remainingTime <= 0) {
                handleTimerEnd();
            }
        }, 1000);
    }

    function pauseTimer() {
        isTimerRunning = false;
        focusElements.startPauseBtn.textContent = 'Старт';
        clearInterval(timerInterval);
        document.title = "Личный Секретарь";
    }

    function resetTimer() {
        pauseTimer();
        remainingTime = timerModes[currentTimerMode];
        updateTimerDisplay();
    }

    function handleTimerEnd() {
        pauseTimer();
        focusElements.alarmSound.play().catch(e => console.log("Автоплей блокирован браузером"));

        // Отправляем PUSH уведомление
        let notifTitle = "Таймер завершен!";
        let notifBody = "Пора сменить деятельность.";

        if (currentTimerMode === 'pomodoro') {
            notifTitle = "Фокус завершен! 🍅";
            notifBody = "Время отдохнуть.";

            if (activeFocusTaskId) {
                const task = allTasks.find(t => t.id === activeFocusTaskId);
                if (task) {
                    notifBody = `Задача: ${task.text}`;
                    if (confirm(`🍅 Помидор завершен! \n\nЗадача: "${task.text}" \n\nОтметить выполненной?`)) {
                        updateTask(task.id, { completed: true });
                    }
                }
            }
        } else {
            notifTitle = "Перерыв окончен! ☕";
            notifBody = "Возвращаемся к работе.";
        }

        sendNotification(notifTitle, notifBody);

        resetActiveFocusTask();

        if (currentTimerMode === 'pomodoro') {
            setTimerMode('shortBreak');
        } else {
            setTimerMode('pomodoro');
        }
    }

    function resetActiveFocusTask() {
        activeFocusTaskId = null;
        focusElements.taskDisplay.innerHTML = `<p>Нажмите на задачу из списка, чтобы выбрать ее.</p>`;
        document.querySelectorAll('#focus-list .task-item.activated').forEach(item => item.classList.remove('activated'));
    }

    // --- Функции Рендеринга (Слегка сокращены для v9.0, логика та же) ---
    function renderTaskList(targetListElement, tasks) {
        targetListElement.innerHTML = "";

        if (tasks.length === 0) {
            // (Код заглушки Empty State из v8.2 - оставь его здесь)
            targetListElement.innerHTML = `<div class="empty-state"><span class="icon">📝</span><h4>Пусто</h4><p>Нет задач</p></div>`;
            return;
        }

        tasks.forEach(task => {
            const li = document.createElement('li');
            li.className = 'task-item';
            li.dataset.id = task.id;
            if (task.completed) li.classList.add('completed');

            const prioritySelect = createPrioritySelect(task.priority);
            const dateInput = document.createElement('input');
            dateInput.type = 'datetime-local';
            dateInput.value = task.date;

            li.innerHTML = `
                <button class="delete-btn">🗑️</button>
                <div class="task-content">
                    <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}>
                    <span>${task.text}</span>
                </div>
                <div class="task-controls"></div>
            `;

            const controlsDiv = li.querySelector('.task-controls');
            controlsDiv.appendChild(prioritySelect);
            controlsDiv.appendChild(dateInput);
            targetListElement.appendChild(li);

            // Inline edit logic
            const span = li.querySelector('.task-content span');
            span.addEventListener('click', () => {
                if (targetListElement.id === 'focus-list') return;
                const currentText = span.textContent;
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentText;
                input.className = 'task-edit-input';
                span.replaceWith(input);
                input.focus();

                const saveChanges = () => {
                    const newText = input.value.trim();
                    if (newText && newText !== currentText) updateTask(task.id, { text: newText });
                    else input.replaceWith(span);
                };
                input.addEventListener('blur', saveChanges);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') saveChanges();
                    else if (e.key === 'Escape') input.replaceWith(span);
                });
            });
        });
    }

    function renderInboxList() {
        if (!screens.inbox) return;
        renderTaskList(inboxElements.list, allTasks.filter(t => !t.date));
    }
    function renderPlanList() {
        if (!screens.plan) return;
        renderTaskList(planElements.list, allTasks.filter(t => !!t.date).sort((a, b) => new Date(a.date) - new Date(b.date)));
    }
    function renderFocusList() {
        if (!screens.focus) return;
        renderTaskList(focusElements.list, getTasksForDay(todayStr).sort((a, b) => new Date(a.date) - new Date(b.date)));
        if (activeFocusTaskId) {
            const activeItem = focusElements.list.querySelector(`.task-item[data-id="${activeFocusTaskId}"]`);
            if (activeItem) activeItem.classList.add('activated');
        }
    }
    function renderCalendarTaskList(dateStr, title) {
        calendarElements.listTitle.textContent = title;
        calendarElements.listTitle.style.display = 'block';
        renderTaskList(calendarElements.taskList, getTasksForDay(dateStr).sort((a, b) => new Date(a.date) - new Date(b.date)));
    }
    function renderCalendar() {
        if (!screens.calendar) return;
        // (Код рендеринга календаря из v8.2 - без изменений)
        calendarElements.grid.innerHTML = "";
        calendarElements.title.textContent = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
        const month = currentDate.getMonth(), year = currentDate.getFullYear();
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const startDay = (firstDayOfMonth === 0) ? 6 : firstDayOfMonth - 1;

        document.querySelectorAll('.calendar-day.active-day').forEach(cell => { if (cell.dataset.date !== todayStr) cell.classList.remove('active-day'); });
        for (let i = 0; i < startDay; i++) calendarElements.grid.innerHTML += `<div class="calendar-day other-month"></div>`;
        for (let day = 1; day <= daysInMonth; day++) {
            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            cell.dataset.date = dateStr;
            cell.innerHTML = `<span>${day}</span>`;
            if (dateStr === todayStr) cell.classList.add('active-day');
            const tasksForDay = allTasks.filter(t => t.date && t.date.startsWith(dateStr) && !t.completed);
            if (tasksForDay.length > 0) {
                cell.innerHTML += `<div class="task-count">${tasksForDay.length}</div>`;
                const highestPriority = Math.min(...tasksForDay.map(t => parseInt(t.priority)));
                cell.classList.add(`priority-${highestPriority}`);
            }
            calendarElements.grid.appendChild(cell);
        }
    }

    function renderAllLists() {
        renderInboxList();
        renderPlanList();
        renderCalendar();
        if (screens.calendar.style.display === 'block') {
            const activeDay = document.querySelector('.calendar-day.active-day');
            const dateStr = activeDay ? activeDay.dataset.date : todayStr;
            const formattedDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('ru-RU');
            const title = dateStr === todayStr ? `Задачи на ${formattedDate} (Сегодня)` : `Задачи на ${formattedDate}`;
            renderCalendarTaskList(dateStr, title);
        }
        if (screens.focus.style.display === 'block') renderFocusList();
    }

    function showWizardStep(stepIndex) {
        // (Код визарда из v8.2)
        if (stepIndex < 0 || stepIndex >= wizardSubcategories.length) return;
        currentStep = stepIndex;
        const stepData = wizardSubcategories[stepIndex];
        wizardElements.categoryTitle.textContent = stepData.category;
        wizardElements.subcategoryTitle.textContent = stepData.name;
        wizardElements.triggersList.innerHTML = "";
        stepData.triggers.forEach(trigger => wizardElements.triggersList.innerHTML += `<li>${trigger}</li>`);
        wizardElements.stepTasksList.innerHTML = "";
        wizardElements.stepCounter.textContent = `Шаг ${stepIndex + 1} / ${wizardSubcategories.length}`;
        wizardElements.prevBtn.disabled = (stepIndex === 0);
        wizardElements.nextBtn.disabled = (stepIndex === wizardSubcategories.length - 1);
    }

    // --- 7. Обработчики Событий ---
    navButtons.inbox.onclick = () => showScreen('inbox');
    navButtons.plan.onclick = () => showScreen('plan');
    navButtons.calendar.onclick = () => showScreen('calendar');
    navButtons.wizard.onclick = () => showScreen('wizard');
    navButtons.focus.onclick = () => showScreen('focus');

    wizardElements.nextBtn.onclick = () => { if (currentStep < wizardSubcategories.length - 1) showWizardStep(currentStep + 1); };
    wizardElements.prevBtn.onclick = () => { if (currentStep > 0) showWizardStep(currentStep - 1); };
    wizardElements.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = wizardElements.taskInput.value.trim();
        const priority = wizardElements.form.querySelector('.priority-select').value;
        const date = wizardElements.taskDate.value;
        if (text) {
            addTask(text, priority, date);
            const li = document.createElement('li'); li.textContent = `✅ ${text}`;
            wizardElements.stepTasksList.prepend(li);
            wizardElements.taskInput.value = ""; wizardElements.taskDate.value = "";
        }
    });

    inboxElements.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const taskText = inboxElements.input.value.trim();
        if (taskText) { addTask(taskText, "4", ""); inboxElements.input.value = ""; renderInboxList(); }
    });

    appContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-btn')) {
            const taskId = parseInt(e.target.closest('.task-item').dataset.id);
            if (confirm(`Удалить задачу?`)) deleteTask(taskId);
        }
    });

    appContainer.addEventListener('change', (e) => {
        const taskItem = e.target.closest('.task-item');
        if (!taskItem) return;
        const taskId = parseInt(taskItem.dataset.id);
        let newValues = {};
        if (e.target.classList.contains('task-checkbox')) newValues.completed = e.target.checked;
        if (e.target.classList.contains('priority-select')) newValues.priority = e.target.value;
        if (e.target.type === 'datetime-local') newValues.date = e.target.value;
        if (Object.keys(newValues).length > 0) updateTask(taskId, newValues);
    });

    calendarNavButtons.prevMonth.onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); };
    calendarNavButtons.nextMonth.onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); };

    calendarElements.grid.addEventListener('click', (e) => {
        const dayCell = e.target.closest('.calendar-day');
        if (dayCell && !dayCell.classList.contains('other-month')) {
            const dateStr = dayCell.dataset.date;
            document.querySelectorAll('.calendar-day.active-day').forEach(cell => cell.classList.remove('active-day'));
            dayCell.classList.add('active-day');
            const formattedDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('ru-RU');
            renderCalendarTaskList(dateStr, dateStr === todayStr ? `Задачи на ${formattedDate} (Сегодня)` : `Задачи на ${formattedDate}`);
        }
    });

    focusElements.startPauseBtn.onclick = () => { isTimerRunning ? pauseTimer() : startTimer(); };
    focusElements.resetBtn.onclick = resetTimer;
    focusElements.btnPomodoro.onclick = () => setTimerMode('pomodoro');
    focusElements.btnShortBreak.onclick = () => setTimerMode('shortBreak');
    focusElements.btnLongBreak.onclick = () => setTimerMode('longBreak');

    focusElements.list.addEventListener('click', (e) => {
        const taskItem = e.target.closest('.task-item');
        if (taskItem) {
            if (taskItem.classList.contains('completed')) return;
            document.querySelectorAll('#focus-list .task-item.activated').forEach(item => item.classList.remove('activated'));
            taskItem.classList.add('activated');
            activeFocusTaskId = parseInt(taskItem.dataset.id);
            focusElements.taskDisplay.innerHTML = `<p class="active-task-text">${taskItem.querySelector('.task-content span').textContent}</p>`;
        }
    });

    // --- 8. ЗАПУСК ---
    // Инициализация базы данных, затем загрузка задач
    initDB()
        .then(() => loadTasksFromDB())
        .catch(err => console.error("Не удалось запустить DB", err));

    setTimerMode('pomodoro');
    showScreen('inbox');

    requestNotificationPermission();

    // (НОВОЕ) Запускаем проверку задач каждую минуту (60 000 мс)
    setInterval(checkScheduledTasks, 60000);

    // (НОВОЕ) И запускаем проверку сразу при старте (на случай перезагрузки страницы в нужную минуту)
    setTimeout(checkScheduledTasks, 2000);

    function checkScheduledTasks() {
        const now = new Date();
        // Форматируем текущее время в строку "YYYY-MM-DDTHH:mm" (как в input type="datetime-local")
        // Важно: учитываем смещение часового пояса
        const offset = now.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(now - offset)).toISOString().slice(0, 16);

        // Ищем задачи, у которых время совпадает с текущим и они не выполнены
        const tasksDue = allTasks.filter(t => t.date === localISOTime && !t.completed);

        tasksDue.forEach(task => {
            sendNotification("⏰ Напоминание", `Пора выполнить: ${task.text}`);

            // Можно проиграть звук (если пользователь взаимодействовал со страницей)
            focusElements.alarmSound.play().catch(e => console.log("Автоплей звука блокирован"));
        });
    }

    document.getElementById('test-notif-btn').onclick = () => {
        // 1. Проверяем, поддерживает ли браузер уведомления
        if (!('Notification' in window)) {
            alert("❌ Этот браузер вообще не поддерживает уведомления!");
            return;
        }

        // 2. Проверяем текущий статус прав
        alert("🔍 Текущий статус прав: " + Notification.permission);

        // 3. Запрашиваем права
        Notification.requestPermission().then(permission => {
            // 4. Сообщаем результат запроса
            alert("📝 Результат запроса прав: " + permission);

            if (permission === "granted") {
                // 5. Пробуем отправить через Service Worker (это важно для Android!)
                if (navigator.serviceWorker.controller) {
                    alert("⚙️ Service Worker найден, отправляем...");

                    navigator.serviceWorker.ready.then(registration => {
                        registration.showNotification("🔔 Тест PWA", {
                            body: "Ура! Если ты это видишь — всё работает.",
                            icon: 'icon-192.png', // Убедись, что картинка есть!
                            vibrate: [200, 100, 200]
                        }).then(() => {
                            alert("✅ Команда на отправку ушла!");
                        }).catch(err => {
                            alert("❌ Ошибка отправки: " + err);
                        });
                    });
                } else {
                    alert("⚠️ Service Worker не активен! Уведомления PWA требуют SW.");
                    // Попытка обычного уведомления (фоллбэк)
                    new Notification("Обычное уведомление", { body: "Без SW" });
                }
            }
        }).catch(err => {
            alert("❌ Ошибка в процессе запроса: " + err);
        });
    };

});
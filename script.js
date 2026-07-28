const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskList = document.getElementById("taskList");

const emptyState = document.getElementById("emptyState");

const totalTasksElement = document.getElementById("totalTasks");
const completedTasksElement = document.getElementById("completedTasks");
const progressNumber = document.getElementById("progressNumber");

const filterButtons = document.querySelectorAll(".filter");

let tasks = [];

let currentFilter = "all";


taskForm.addEventListener("submit", function (event) {

    event.preventDefault();

    const taskText = taskInput.value.trim();

    if (taskText === "") {
        return;
    }

    const newTask = {
        id: Date.now(),
        text: taskText,
        completed: false
    };

    tasks.push(newTask);

    taskInput.value = "";

    taskInput.focus();

    renderTasks();

});


function renderTasks() {

    taskList.innerHTML = "";

    const filteredTasks = tasks.filter(function (task) {

        if (currentFilter === "pending") {
            return !task.completed;
        }

        if (currentFilter === "completed") {
            return task.completed;
        }

        return true;

    });


    filteredTasks.forEach(function (task) {

        const li = document.createElement("li");

        li.classList.add("task-item");

        if (task.completed) {
            li.classList.add("completed");
        }


        const checkbox = document.createElement("button");

        checkbox.classList.add("task-checkbox");

        checkbox.innerHTML = task.completed ? "✓" : "";

        checkbox.addEventListener("click", function () {

            toggleTask(task.id);

        });


        const text = document.createElement("span");

        text.classList.add("task-text");

        text.textContent = task.text;


        const deleteButton = document.createElement("button");

        deleteButton.classList.add("delete-button");

        deleteButton.textContent = "Excluir";

        deleteButton.addEventListener("click", function () {

            deleteTask(task.id);

        });


        li.appendChild(checkbox);
        li.appendChild(text);
        li.appendChild(deleteButton);

        taskList.appendChild(li);

    });


    updateTaskInfo();

    updateEmptyState(filteredTasks);

}


function toggleTask(id) {

    tasks = tasks.map(function (task) {

        if (task.id === id) {

            return {
                ...task,
                completed: !task.completed
            };

        }

        return task;

    });

    renderTasks();

}


function deleteTask(id) {

    tasks = tasks.filter(function (task) {

        return task.id !== id;

    });

    renderTasks();

}


function updateTaskInfo() {

    const total = tasks.length;

    const completed = tasks.filter(function (task) {

        return task.completed;

    }).length;


    totalTasksElement.textContent = total;

    completedTasksElement.textContent = completed;


    const progress =
        total === 0
            ? 0
            : Math.round((completed / total) * 100);


    progressNumber.textContent = progress + "%";

}


function updateEmptyState(filteredTasks) {

    if (filteredTasks.length === 0) {

        emptyState.classList.remove("hidden");

    } else {

        emptyState.classList.add("hidden");

    }

}


filterButtons.forEach(function (button) {

    button.addEventListener("click", function () {

        filterButtons.forEach(function (item) {

            item.classList.remove("active");

        });


        button.classList.add("active");

        currentFilter = button.dataset.filter;

        renderTasks();

    });

});


renderTasks();
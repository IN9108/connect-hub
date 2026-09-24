// function toggleStory(button) {

//     const content =
//         button.nextElementSibling;

//     content.classList.toggle("open");

//     button.textContent =
//         content.classList.contains("open")
//             ? "Hide Story"
//             : "Read Story";

// }

// function copyPrompt(id) {

//     const text =
//         document.getElementById(id).innerText;

//     navigator.clipboard.writeText(text);

// }

// const observer =
//     new IntersectionObserver((entries) => {

//         entries.forEach(entry => {

//             if (entry.isIntersecting) {

//                 entry.target.classList.add("visible");

//             }

//         });

//     }, {
//         threshold: 0.15
//     });

// document
//     .querySelectorAll(".reveal")
//     .forEach(el => observer.observe(el));

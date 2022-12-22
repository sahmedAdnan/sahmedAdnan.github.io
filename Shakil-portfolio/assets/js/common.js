/*=============== Show Menu =============== */
const navMenu = document.getElementById ('nav-menu'),
    navToggle = document.getElementById('nav-toggle'),
    navClose = document.getElementById ('nav-close');
/*===== Menu Show =====*/
/* Validate if constant exists */
if (navToggle) {
    navToggle.addEventListener('click', () => {
        navMenu.classList.add('show-menu');
    });
}

/*===== Hide Show =====*/
/* Validate if constant exists */
if (navClose) {
    navClose.addEventListener('click', () => {
        navMenu.classList.remove('show-menu');
    });
}


/*=============== Remove Menu Mobile =============== */

const navLink = document.querySelectorAll('.nav__link');

function linkAction() {
    const navMenu = document.getElementById ('nav-menu');
    // when click on each link, remove the show menu
    navMenu.classList.remove('show-menu');
}

navLink.forEach((n) => n.addEventListener ('click', linkAction));

/*=============== Background Header =============== */
function scrollHeader (){
    const header = document.getElementById('header');
    if(this.scrollY >= 50) header.classList.add('scroll-header');
    else header.classList.remove('scroll-header');
}  
window.addEventListener('scroll', scrollHeader);

/*=============== Contact Form =============== */

/*=============== Style Switcher =============== */
const styleSwitcherToggle = document.querySelector ('.style__switcher-toggler'),
styleSwitcher = document.querySelector ('.style__switcher');

styleSwitcherToggle.addEventListener('click', () => {
    styleSwitcher.classList.toggle('open');
});

// Hide switcher on scroll
window.addEventListener('scroll', () => {
    if (styleSwitcher.classList.contains('open')) {
        styleSwitcher.classList.remove('open');
    }
});

const alternateStyles = document.querySelectorAll ('.alternate-style');

function setActiveStyle(color){
    alternateStyles.forEach((style) => {
        if (color === style.getAttribute('title')){
            style.removeAttribute('disabled');
        } else {
            style.setAttribute('disabled', 'true');
        }
    });
}
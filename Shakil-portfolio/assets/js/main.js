/*=============== Active Link =============== */
const navlink = document.querySelectorAll('.nav__link');

function activeLink(){
    navlink.forEach((a) => a.classList.remove('active-link'));
    this.classList.add('active-link');
}
navlink.forEach((a) => a.addEventListener('click', activeLink));


/*=============== Background Header =============== */
function scrollHeader (){
  const header = document.getElementById('header');
  if(this.scrollY >= 50) header.classList.add('scroll-header');
  else header.classList.remove('scroll-header');
}


window.addEventListener('scroll', scrollHeader);

/*=============== Mixitup Filter =============== */
let mixerProjects = mixitup('.projects__container', {
    selectors: {
        target: '.project__item'
    },
    animation: {
        duration: 300
    }
});

/*=============== Active work =============== */
const linkWork = document.querySelectorAll('.category__btn');

function activeWork(){
    linkWork.forEach((a) => a.classList.remove('active-work'));
    this.classList.add('active-work');
}
linkWork.forEach((a) => a.addEventListener('click', activeWork));
/*=============== Testimonials Swiper =============== */

var swiper = new Swiper(".testimonial__container", {
    loop: true,
    navigation: {
      nextEl: ".swiper-button-next",
      prevEl: ".swiper-button-prev",
    },
    pagination: {
      el: ".swiper-pagination",
    },
    mousewheel: true,
    keyboard: true,
  });
/*=============== Contact Form =============== */

const contactForm = document.getElementById('contact-form'),
  contactName = document.getElementById('contact-name'),
  contactEmail = document.getElementById('contact-email'),
  Message = document.getElementById('message'),
  contactMessage = document.getElementById('contact-message');

  const sendEmail = (e) => {
    e.preventDefault();
    
    if (contactName.value === '' || contactEmail.value === '' || Message.value === '') {
      contactMessage.classList.remove('color-light');
      contactMessage.classList.add('color-dark');

      // show message
      contactMessage.textContent = "Write all the input fields.";
    }
    else {
      // serviceID, templateID, #form, publickey
      emailjs.sendForm(
        'service_s5pyocq', 
        'template_mbrgs9w', 
        '#contact-form', 
        '7jXYHGGphtyq79mZ2').then(() => {
        // show message and add color, window 
        contactMessage.classList.add('color-light');
        contactMessage.textContent = 'Message has sent ✅';

        //remove messsage after 4 sec
        setTimeout(() => {
          contactMessage.textContent = '';
        }, 4000);
      }, (error) => {alert('OOPS! SOMETHING WENT WRONG... 😒');
    });
    // clear input fields
    contactName.value = '';
    contactEmail.value = '';
    Message.value = '';
    }
  };
  contactForm.addEventListener('submit', sendEmail);
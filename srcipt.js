// Update copyright year
document.getElementById('year').textContent = new Date().getFullYear();

// Navbar scroll effect
window.addEventListener('scroll', function() {
    const navbar = document.getElementById('navbar');
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// Scroll animation for elements
function animateOnScroll() {
    const elements = document.querySelectorAll('.animate-on-scroll');

    elements.forEach(element => {
        const elementPosition = element.getBoundingClientRect().top;
        const screenPosition = window.innerHeight / 1.3;

        if (elementPosition < screenPosition) {
            element.classList.add('animated');
        }
    });
}

// Initialize animations on load and scroll
window.addEventListener('scroll', animateOnScroll);
window.addEventListener('load', animateOnScroll);

// Smooth scrolling for navigation
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();

        document.querySelector(this.getAttribute('href')).scrollIntoView({
            behavior: 'smooth'
        });
    });
});

// Signal Processing Visualization
document.addEventListener('DOMContentLoaded', function() {
    const header = document.querySelector('header');
    const canvas = document.getElementById('signalCanvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size
    function resizeCanvas() {
        canvas.width = header.offsetWidth;
        canvas.height = header.offsetHeight;
    }

    resizeCanvas();

    // Sine wave parameters
    const waves = [
        { amplitude: 30, frequency: 0.01, speed: 0.02, color: 'rgba(255, 255, 255, 0.3)' },
        { amplitude: 40, frequency: 0.015, speed: 0.03, color: 'rgba(255, 255, 255, 0.2)' },
        { amplitude: 50, frequency: 0.02, speed: 0.04, color: 'rgba(255, 255, 255, 0.15)' }
    ];

    let time = 0;

    function animateWaves() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        waves.forEach(wave => {
            ctx.beginPath();
            ctx.strokeStyle = wave.color;
            ctx.lineWidth = 2;

            for (let x = 0; x < canvas.width; x++) {
                const y = canvas.height / 2 +
                          wave.amplitude * Math.sin(x * wave.frequency + time * wave.speed) +
                          10 * Math.sin(x * 0.05 + time * 0.1);

                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }

            ctx.stroke();
        });

        time += 0.05;
        requestAnimationFrame(animateWaves);
    }

    // Start animation
    animateWaves();

    // Handle window resize
    window.addEventListener('resize', function() {
        resizeCanvas();
    });
});

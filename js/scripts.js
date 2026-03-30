
const heroCarousel = document.getElementById('heroCarousel');
if (heroCarousel) {
  heroCarousel.addEventListener('slide.bs.carousel', (ev) => {
    console.log('Cambio de slide:', ev.to);
  });
}
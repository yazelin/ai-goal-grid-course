/* 簡報翻頁:← → / 空白鍵 / 點擊左右 1/4 區 / 觸控滑動;網址 hash 記頁碼 */
(function () {
  const slides = [...document.querySelectorAll(".slide")];
  const prog = document.getElementById("prog");
  const counter = document.getElementById("counter");
  let cur = Math.min(Math.max(parseInt(location.hash.slice(1)) || 1, 1), slides.length) - 1;

  function show(i) {
    cur = Math.min(Math.max(i, 0), slides.length - 1);
    slides.forEach((s, j) => s.classList.toggle("active", j === cur));
    if (prog) prog.style.width = ((cur + 1) / slides.length * 100) + "%";
    if (counter) counter.textContent = (cur + 1) + " / " + slides.length;
    history.replaceState(null, "", "#" + (cur + 1));
  }

  addEventListener("keydown", e => {
    if (["ArrowRight", " ", "PageDown"].includes(e.key)) { e.preventDefault(); show(cur + 1); }
    if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); show(cur - 1); }
    if (e.key === "Home") show(0);
    if (e.key === "End") show(slides.length - 1);
  });

  addEventListener("click", e => {
    if (e.target.closest("a, pre, button")) return;
    const x = e.clientX / innerWidth;
    if (x > 0.75) show(cur + 1);
    else if (x < 0.25) show(cur - 1);
  });

  let tx = null;
  addEventListener("touchstart", e => tx = e.touches[0].clientX, { passive: true });
  addEventListener("touchend", e => {
    if (tx === null) return;
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1));
    tx = null;
  }, { passive: true });

  show(cur);
})();

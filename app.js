"use strict";

/* ============================================================
   Wildnest — light, simple interactions only
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const nav = document.getElementById("nav");
  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");

  /* --- Sticky nav: swap to solid state after scrolling past the hero top --- */
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle("scrolled", window.scrollY > 40);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* --- Mobile menu toggle --- */
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
      const open = navLinks.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
    // Close after tapping a link
    navLinks.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        navLinks.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      })
    );
  }

  /* --- Reveal-on-scroll (progressive enhancement) --- */
  const revealTargets = document.querySelectorAll(
    ".section-head, .product-card, .split-media, .split-text, .polaroid, .cta-card, .detail-grid, .detail-gallery figure"
  );
  revealTargets.forEach((el) => el.classList.add("reveal"));

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealTargets.forEach((el) => io.observe(el));
  } else {
    revealTargets.forEach((el) => el.classList.add("in"));
  }

  /* --- Gallery rail: drag-to-scroll on desktop --- */
  const rail = document.getElementById("polaroidRail");
  if (rail) {
    let down = false, startX = 0, startScroll = 0;
    rail.addEventListener("pointerdown", (e) => {
      down = true;
      startX = e.clientX;
      startScroll = rail.scrollLeft;
      rail.style.cursor = "grabbing";
    });
    const end = () => { down = false; rail.style.cursor = ""; };
    rail.addEventListener("pointerup", end);
    rail.addEventListener("pointerleave", end);
    rail.addEventListener("pointermove", (e) => {
      if (!down) return;
      rail.scrollLeft = startScroll - (e.clientX - startX);
    });
  }

  /* --- Booking form: friendly client-side handling (no backend) --- */
  const form = document.getElementById("quoteForm");
  const note = document.getElementById("formNote");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = form.querySelector("#name");
      const email = form.querySelector("#email");
      if (!name.value.trim() || !email.value.trim()) {
        if (note) note.textContent = "Please add your name and email so we can reply.";
        return;
      }
      if (note) note.textContent = `Thanks, ${name.value.trim().split(" ")[0]} — we'll confirm your spot by the water within a day.`;
      form.reset();
    });
  }

  /* --- Footer year --- */
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
});

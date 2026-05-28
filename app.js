"use strict";

// İzin/erişim durumları
const STATUS = {
  pending: { label: "Bekliyor", cls: "pending", icon: "•" },
  granted: { label: "Erişildi", cls: "granted", icon: "✓" },
  denied: { label: "Reddedildi", cls: "denied", icon: "✕" },
  unsupported: { label: "Desteklenmiyor", cls: "unsupported", icon: "!" },
};

// Sonuç kutusuna yardımcı yazıcılar
function text(el, str) {
  el.textContent = "";
  const pre = document.createElement("pre");
  pre.textContent = str;
  el.appendChild(pre);
}
function clear(el) {
  el.textContent = "";
}

// Dosya boyutunu okunur biçime çevir
function humanSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return val.toFixed(1) + " " + units[i];
}

// Gizli dosya seçici; iptal edilirse null döndürür (askıda kalmaz)
function pickFiles(accept, multiple) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    if (multiple) input.multiple = true;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);

    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener("focus", onFocus);
      resolve(val);
    };
    const onChange = () => finish(input.files);
    const onFocus = () =>
      setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) finish(null);
      }, 600);

    input.addEventListener("change", onChange, { once: true });
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

// ----- Özellik tanımları -----
// Her özellik kendi sonuç kutusuna (el) yazar ve bir STATUS anahtarı döndürür.

let cameraStream = null;
let micStream = null;
let motionHandlers = null;

const FEATURES = [
  {
    id: "photos",
    icon: "🖼️",
    title: "Fotoğraflar",
    question: "Fotoğraflarınıza erişebildim mi?",
    btn: "Fotoğraf seç",
    async run(el) {
      const files = await pickFiles("image/*", true);
      if (!files || files.length === 0) return "pending";
      clear(el);
      const grid = document.createElement("div");
      grid.className = "photo-grid";
      [...files].forEach((f) => {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(f);
        img.onload = () => URL.revokeObjectURL(img.src);
        grid.appendChild(img);
      });
      const caption = document.createElement("div");
      caption.style.marginBottom = "8px";
      caption.textContent = `${files.length} fotoğrafa erişildi.`;
      el.appendChild(caption);
      el.appendChild(grid);
      return "granted";
    },
  },
  {
    id: "files",
    icon: "📁",
    title: "Dosyalar",
    question: "Dosyalarınıza ulaşabildim mi?",
    btn: "Dosya seç",
    async run(el) {
      const files = await pickFiles(null, true);
      if (!files || files.length === 0) return "pending";
      clear(el);
      const ul = document.createElement("ul");
      ul.className = "file-list";
      [...files].forEach((f) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = f.name;
        const size = document.createElement("span");
        size.className = "size";
        size.textContent = humanSize(f.size);
        li.append(name, size);
        ul.appendChild(li);
      });
      el.appendChild(ul);
      return "granted";
    },
  },
  {
    id: "camera",
    icon: "📷",
    title: "Kamera",
    question: "Kameranızı kullanabilir miyim?",
    btn: "Kamerayı aç",
    async run(el) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
        return "unsupported";
      try {
        if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        clear(el);
        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.srcObject = cameraStream;
        el.appendChild(video);
        return "granted";
      } catch (err) {
        if (err.name === "NotAllowedError" || err.name === "SecurityError")
          return "denied";
        text(el, "Hata: " + err.message);
        return "denied";
      }
    },
  },
  {
    id: "microphone",
    icon: "🎙️",
    title: "Mikrofon",
    question: "Mikrofonunuzu dinleyebilir miyim?",
    btn: "Mikrofonu aç",
    async run(el) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
        return "unsupported";
      try {
        if (micStream) micStream.getTracks().forEach((t) => t.stop());
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        clear(el);
        const label = document.createElement("div");
        label.textContent = "Ses seviyesi:";
        label.style.marginBottom = "6px";
        const meter = document.createElement("div");
        meter.className = "meter";
        const fill = document.createElement("div");
        fill.className = "meter-fill";
        meter.appendChild(fill);
        el.append(label, meter);

        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const src = ctx.createMediaStreamSource(micStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!micStream.active) return;
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          fill.style.width = Math.min(100, (avg / 140) * 100) + "%";
          requestAnimationFrame(tick);
        };
        tick();
        return "granted";
      } catch (err) {
        if (err.name === "NotAllowedError") return "denied";
        text(el, "Hata: " + err.message);
        return "denied";
      }
    },
  },
  {
    id: "location",
    icon: "📍",
    title: "Konum",
    question: "Konumunuza erişebilir miyim?",
    btn: "Konumu al",
    run(el) {
      return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve("unsupported");
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            clear(el);
            text(
              el,
              `Enlem: ${latitude.toFixed(5)}\nBoylam: ${longitude.toFixed(
                5
              )}\nDoğruluk: ±${Math.round(accuracy)} m`
            );
            const link = document.createElement("a");
            link.href = `https://maps.apple.com/?ll=${latitude},${longitude}`;
            link.textContent = "Haritada aç";
            link.target = "_blank";
            link.style.display = "inline-block";
            link.style.marginTop = "8px";
            link.style.color = "var(--blue)";
            el.appendChild(link);
            resolve("granted");
          },
          (err) => {
            resolve(err.code === err.PERMISSION_DENIED ? "denied" : "denied");
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });
    },
  },
  {
    id: "notifications",
    icon: "🔔",
    title: "Bildirimler",
    question: "Size bildirim gönderebilir miyim?",
    btn: "İzin iste",
    async run(el) {
      if (!("Notification" in window)) return "unsupported";
      const res = await Notification.requestPermission();
      if (res !== "granted") return "denied";
      try {
        new Notification("iPhone Denetimi", {
          body: "Bildirim izni başarıyla verildi.",
        });
        text(el, "Bildirim izni verildi ve test bildirimi gönderildi.");
      } catch (e) {
        text(el, "İzin verildi (test bildirimi bu bağlamda gösterilemedi).");
      }
      return "granted";
    },
  },
  {
    id: "motion",
    icon: "📐",
    title: "Hareket ve Yön",
    question: "Hareket sensörlerinizi okuyabilir miyim?",
    btn: "Sensörü aç",
    async run(el) {
      const hasMotion = typeof DeviceMotionEvent !== "undefined";
      const hasOrient = typeof DeviceOrientationEvent !== "undefined";
      if (!hasMotion && !hasOrient) return "unsupported";

      if (hasMotion && typeof DeviceMotionEvent.requestPermission === "function") {
        try {
          if ((await DeviceMotionEvent.requestPermission()) !== "granted")
            return "denied";
        } catch (e) {
          return "denied";
        }
      }
      if (
        hasOrient &&
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        try {
          await DeviceOrientationEvent.requestPermission();
        } catch (e) {
          /* yön izni isteğe bağlı */
        }
      }

      // Önceki dinleyicileri kaldır (tekrar açılırsa)
      if (motionHandlers) {
        window.removeEventListener("deviceorientation", motionHandlers.orient);
        window.removeEventListener("devicemotion", motionHandlers.motion);
        motionHandlers = null;
      }

      el.innerHTML = `
        <div class="motion-detail">
          <div class="scene">
            <div class="phone3d">
              <div class="face front"><div class="notch"></div><div class="screen"></div></div>
              <div class="face back"><div class="cam"></div></div>
              <div class="face left"></div>
              <div class="face right"></div>
              <div class="face top"></div>
              <div class="face bottom"></div>
            </div>
          </div>
          <div class="motion-readout">
            <div class="gmeter-circle">
              <span class="ring"></span>
              <span class="cross-h"></span>
              <span class="cross-v"></span>
              <span class="dot"></span>
            </div>
            <div class="gmeter-num"><strong class="g-now">0.00</strong> G
              <span class="gmeter-peak">tepe: <span class="g-peak">0.00</span> G</span>
            </div>
            <pre class="orient-vals">Cihazı hareket ettirin…</pre>
          </div>
        </div>`;

      const phone = el.querySelector(".phone3d");
      const dot = el.querySelector(".dot");
      const gNow = el.querySelector(".g-now");
      const gPeak = el.querySelector(".g-peak");
      const orientOut = el.querySelector(".orient-vals");
      let peak = 0;

      // Jiroskop/yönelim → 3B telefonu döndür (yaklaşık)
      const orient = (ev) => {
        const a = ev.alpha || 0;
        const b = ev.beta || 0;
        const g = ev.gamma || 0;
        phone.style.transform = `rotateX(${b}deg) rotateY(${g}deg) rotateZ(${-a}deg)`;
        orientOut.textContent = `α ${a.toFixed(0)}°   β ${b.toFixed(
          0
        )}°   γ ${g.toFixed(0)}°`;
      };

      // İvmeölçer → G-metre
      const clamp = (v) => Math.max(-1, Math.min(1, v / 1.5));
      const motion = (ev) => {
        const acc =
          ev.acceleration && ev.acceleration.x !== null
            ? ev.acceleration
            : ev.accelerationIncludingGravity;
        if (!acc) return;
        const gx = (acc.x || 0) / 9.81;
        const gy = (acc.y || 0) / 9.81;
        const gz = (acc.z || 0) / 9.81;
        const mag = Math.sqrt(gx * gx + gy * gy + gz * gz);
        gNow.textContent = mag.toFixed(2);
        if (mag > peak) {
          peak = mag;
          gPeak.textContent = peak.toFixed(2);
        }
        dot.style.left = 50 + clamp(gx) * 42 + "%";
        dot.style.top = 50 - clamp(gy) * 42 + "%";
      };

      window.addEventListener("deviceorientation", orient);
      window.addEventListener("devicemotion", motion);
      motionHandlers = { orient, motion };
      return "granted";
    },
  },
  {
    id: "clipboard",
    icon: "📋",
    title: "Pano",
    question: "Panonuzu okuyabilir miyim?",
    btn: "Panoyu oku",
    async run(el) {
      if (!navigator.clipboard || !navigator.clipboard.readText)
        return "unsupported";
      try {
        const content = await navigator.clipboard.readText();
        clear(el);
        text(el, content ? "Pano içeriği:\n" + content : "Pano boş.");
        return "granted";
      } catch (err) {
        return "denied";
      }
    },
  },
  {
    id: "wakelock",
    icon: "🔆",
    title: "Ekranı Açık Tut",
    question: "Ekranınızın kapanmasını engelleyebilir miyim?",
    btn: "Etkinleştir",
    async run(el) {
      if (!("wakeLock" in navigator)) return "unsupported";
      try {
        const lock = await navigator.wakeLock.request("screen");
        text(el, "Ekran uyanık tutuluyor.");
        lock.addEventListener("release", () => {});
        return "granted";
      } catch (err) {
        return "denied";
      }
    },
  },
  {
    id: "share",
    icon: "📤",
    title: "Paylaşım",
    question: "Paylaşım sayfasını açabilir miyim?",
    btn: "Paylaş",
    async run(el) {
      if (!navigator.share) return "unsupported";
      try {
        await navigator.share({
          title: "iPhone Özellik Denetimi",
          text: "iPhone özelliklerini test ediyorum.",
        });
        text(el, "Paylaşım sayfası açıldı.");
        return "granted";
      } catch (err) {
        if (err.name === "AbortError") return "pending";
        return "denied";
      }
    },
  },
  {
    id: "speech",
    icon: "🔊",
    title: "Sesli Okuma",
    question: "Hoparlörden sizinle konuşabilir miyim?",
    btn: "Konuş",
    run(el) {
      if (!("speechSynthesis" in window)) return "unsupported";
      const u = new SpeechSynthesisUtterance(
        "Merhaba, iPhone özellik denetimine hoş geldiniz."
      );
      u.lang = "tr-TR";
      window.speechSynthesis.speak(u);
      text(el, "Sesli mesaj çalınıyor.");
      return "granted";
    },
  },
  {
    id: "battery",
    icon: "🔋",
    title: "Pil Durumu",
    question: "Pil seviyenizi görebilir miyim?",
    btn: "Pili oku",
    async run(el) {
      if (!navigator.getBattery) return "unsupported";
      try {
        const b = await navigator.getBattery();
        text(
          el,
          `Seviye: %${Math.round(b.level * 100)}\nŞarjda: ${
            b.charging ? "Evet" : "Hayır"
          }`
        );
        return "granted";
      } catch (e) {
        return "denied";
      }
    },
  },
  {
    id: "vibration",
    icon: "📳",
    title: "Titreşim",
    question: "Cihazınızı titretebilir miyim?",
    btn: "Titret",
    run(el) {
      if (!("vibrate" in navigator)) return "unsupported";
      const ok = navigator.vibrate([200, 100, 200]);
      text(el, ok ? "Titreşim gönderildi." : "Titreşim desteklenmiyor.");
      return ok ? "granted" : "unsupported";
    },
  },
  {
    id: "contacts",
    icon: "👤",
    title: "Kişiler",
    question: "Kişilerinize erişebilir miyim?",
    btn: "Kişi seç",
    async run(el) {
      if (!("contacts" in navigator) || !navigator.contacts.select)
        return "unsupported";
      try {
        const contacts = await navigator.contacts.select(["name", "tel"], {
          multiple: true,
        });
        text(el, `${contacts.length} kişi seçildi.`);
        return contacts.length ? "granted" : "pending";
      } catch (err) {
        return "denied";
      }
    },
  },
  {
    id: "bluetooth",
    icon: "🔵",
    title: "Bluetooth",
    question: "Bluetooth cihazlarını tarayabilir miyim?",
    btn: "Cihaz ara",
    async run(el) {
      if (!navigator.bluetooth || !navigator.bluetooth.requestDevice)
        return "unsupported";
      try {
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
        });
        text(el, "Bağlandı: " + (device.name || "isimsiz cihaz"));
        return "granted";
      } catch (err) {
        if (err.name === "NotFoundError") return "pending";
        return "denied";
      }
    },
  },
  {
    id: "network",
    icon: "📶",
    title: "Ağ Bilgisi",
    question: "Ağ durumunuzu görebilir miyim?",
    btn: "Kontrol et",
    run(el) {
      const c =
        navigator.connection ||
        navigator.mozConnection ||
        navigator.webkitConnection;
      const lines = [`Çevrim içi: ${navigator.onLine ? "Evet" : "Hayır"}`];
      if (c) {
        if (c.effectiveType) lines.push(`Bağlantı türü: ${c.effectiveType}`);
        if (c.downlink) lines.push(`Hız (tahmini): ${c.downlink} Mbps`);
      }
      text(el, lines.join("\n"));
      return "granted";
    },
  },
  {
    id: "device",
    icon: "📱",
    title: "Cihaz Bilgisi",
    question: "Cihaz bilgilerinizi okuyabilir miyim?",
    btn: "Oku",
    run(el) {
      const lines = [
        `Platform: ${navigator.platform || "bilinmiyor"}`,
        `Dil: ${navigator.language}`,
        `Ekran: ${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
        `Çekirdek sayısı: ${navigator.hardwareConcurrency || "bilinmiyor"}`,
      ];
      if (navigator.deviceMemory) lines.push(`Bellek: ~${navigator.deviceMemory} GB`);
      text(el, lines.join("\n"));
      return "granted";
    },
  },
];

// ----- Arayüz oluşturma -----
const listEl = document.getElementById("featureList");
const cards = {};

function setStatus(id, status) {
  const card = cards[id];
  if (!card) return;
  card.status = status;
  const meta = STATUS[status] || STATUS.pending;
  card.badge.className = "badge " + meta.cls;
  card.badge.textContent = meta.icon + " " + meta.label;
  card.el.dataset.status = status;
  updateSummary();
}

function buildCard(feature) {
  const el = document.createElement("section");
  el.className = "feature card";
  el.id = "feat-" + feature.id;

  const main = document.createElement("div");
  main.className = "feature-main";

  const icon = document.createElement("div");
  icon.className = "feature-icon";
  icon.textContent = feature.icon;

  const info = document.createElement("div");
  info.className = "feature-info";
  const title = document.createElement("p");
  title.className = "feature-title";
  title.textContent = feature.title;
  const question = document.createElement("p");
  question.className = "feature-question";
  question.textContent = feature.question;
  info.append(title, question);

  const badge = document.createElement("span");
  badge.className = "badge pending";
  badge.textContent = STATUS.pending.icon + " " + STATUS.pending.label;

  main.append(icon, info, badge);

  const actions = document.createElement("div");
  actions.className = "feature-actions";
  const btn = document.createElement("button");
  btn.className = "btn btn-sm";
  btn.textContent = feature.btn;
  actions.appendChild(btn);

  const result = document.createElement("div");
  result.className = "feature-result";

  el.append(main, actions, result);
  listEl.appendChild(el);

  cards[feature.id] = { el, badge, status: "pending" };

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const status = await feature.run(result);
      setStatus(feature.id, status);
    } catch (err) {
      text(result, "Beklenmeyen hata: " + err.message);
      setStatus(feature.id, "denied");
    } finally {
      btn.disabled = false;
    }
  });

  return btn;
}

function updateSummary() {
  const total = FEATURES.length;
  const granted = Object.values(cards).filter(
    (c) => c.status === "granted"
  ).length;
  const pct = total ? Math.round((granted / total) * 100) : 0;

  document.getElementById("summaryGranted").textContent = granted;
  document.getElementById("summaryTotal").textContent = total;
  document.getElementById("summaryPct").textContent = pct + "%";
  document.getElementById("summaryRing").style.setProperty("--pct", pct);

  const denied = Object.values(cards).filter((c) => c.status === "denied").length;
  const unsupported = Object.values(cards).filter(
    (c) => c.status === "unsupported"
  ).length;
  const sub = document.getElementById("summarySub");
  if (granted === 0 && denied === 0 && unsupported === 0) {
    sub.textContent = "Henüz hiçbir izin istenmedi";
  } else {
    sub.textContent = `${denied} reddedildi · ${unsupported} desteklenmiyor`;
  }
}

// Tüm kartları oluştur
const buttons = FEATURES.map(buildCard);
updateSummary();

// Hepsini sırayla iste
document.getElementById("runAllBtn").addEventListener("click", async () => {
  const runBtn = document.getElementById("runAllBtn");
  runBtn.disabled = true;
  runBtn.textContent = "İzinler isteniyor…";
  for (let i = 0; i < FEATURES.length; i++) {
    const feature = FEATURES[i];
    const card = cards[feature.id];
    card.el.scrollIntoView({ block: "center", behavior: "smooth" });
    const result = card.el.querySelector(".feature-result");
    try {
      const status = await feature.run(result);
      setStatus(feature.id, status);
    } catch (err) {
      setStatus(feature.id, "denied");
    }
  }
  runBtn.textContent = "Tekrar dene";
  runBtn.disabled = false;
});

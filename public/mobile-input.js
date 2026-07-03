(function () {
  const isMobileLike = () =>
    window.matchMedia("(max-width: 700px)").matches ||
    /Android|iPhone|iPad|iPod|Mobile|MicroMessenger/i.test(navigator.userAgent);

  if (!isMobileLike()) return;

  const style = document.createElement("style");
  style.textContent = `
    .kw-mobile-typing {
      position: fixed;
      left: 50%;
      bottom: 78px;
      z-index: 60;
      width: min(220px, calc(100vw - 32px));
      height: 44px;
      transform: translateX(-50%);
      border: 1px solid rgba(99, 102, 241, 0.45);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.96);
      color: #111827;
      font-size: 16px;
      font-weight: 600;
      line-height: 44px;
      text-align: center;
      box-shadow: 0 16px 36px rgba(79, 70, 229, 0.22);
      outline: none;
      resize: none;
      caret-color: #6366f1;
      overflow: hidden;
    }
    .kw-mobile-typing::placeholder { color: #6366f1; opacity: 1; }
    .dark .kw-mobile-typing {
      background: rgba(17, 24, 39, 0.96);
      color: #f9fafb;
      border-color: rgba(129, 140, 248, 0.7);
    }
    body.kw-mobile-hide-typing .kw-mobile-typing { display: none; }
  `;
  document.head.append(style);

  const input = document.createElement("textarea");
  input.className = "kw-mobile-typing";
  input.placeholder = "点这里输入";
  input.autocomplete = "off";
  input.autocapitalize = "none";
  input.spellcheck = false;
  input.rows = 1;
  input.setAttribute("aria-label", "手机输入");
  input.setAttribute("inputmode", "text");
  document.body.append(input);

  const isPracticePage = () => {
    const base = window.__QWERTY_BASE__ || "";
    const path = location.pathname.slice(base.length) || "/";
    return path === "/" || path === "";
  };

  const updateVisibility = () => {
    document.body.classList.toggle("kw-mobile-hide-typing", !isPracticePage());
  };

  const codeForKey = (key) => {
    if (key === " ") return "Space";
    if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
    if (/^[0-9]$/.test(key)) return `Digit${key}`;
    if (key === "Backspace") return "Backspace";
    if (key === "Enter") return "Enter";
    return "";
  };

  const keyCodeForKey = (key) => {
    if (key === " ") return 32;
    if (key === "Backspace") return 8;
    if (key === "Enter") return 13;
    if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
    if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
    return key.length === 1 ? key.charCodeAt(0) : 0;
  };

  const fireKey = (key) => {
    const keyCode = keyCodeForKey(key);
    const eventInit = {
      key,
      code: codeForKey(key),
      keyCode,
      which: keyCode,
      charCode: key.length === 1 ? keyCode : 0,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    document.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    if (key.length === 1) document.dispatchEvent(new KeyboardEvent("keypress", eventInit));
    document.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    document.dispatchEvent(new CustomEvent("keyworld:mobile-input", { bubbles: true }));
  };

  const focusInput = () => {
    if (!isPracticePage()) return;
    input.focus({ preventScroll: true });
  };

  input.addEventListener("beforeinput", (event) => {
    if (!isPracticePage()) return;
    const type = event.inputType || "";
    if (type.startsWith("delete")) {
      event.preventDefault();
      fireKey("Backspace");
      input.value = "";
      return;
    }
    if (type === "insertLineBreak") {
      event.preventDefault();
      fireKey("Enter");
      input.value = "";
      return;
    }
    if (event.data) {
      event.preventDefault();
      for (const char of event.data) fireKey(char === "\n" ? "Enter" : char);
      input.value = "";
    }
  });

  input.addEventListener("input", () => {
    if (!input.value) return;
    for (const char of input.value) fireKey(char === "\n" ? "Enter" : char);
    input.value = "";
  });

  document.addEventListener(
    "click",
    (event) => {
      if (!isPracticePage()) return;
      if (event.target.closest("ql-auth, input, textarea, select")) return;
      const text = (event.target.innerText || event.target.textContent || "").trim();
      if (text === "Start" || text.includes("按任意键开始") || event.target.closest("main")) {
        setTimeout(focusInput, 0);
      }
    },
    true
  );

  window.addEventListener("popstate", updateVisibility);
  setInterval(updateVisibility, 1000);
  updateVisibility();
})();

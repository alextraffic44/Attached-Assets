import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X } from "lucide-react";

export type UITemplateCategory = "buttons" | "cards" | "toggles" | "loaders" | "forms";

interface UITemplate {
  id: string;
  name: string;
  author: string;
  html: string;
  css: string;
}

const BUTTON_TEMPLATES: UITemplate[] = [
  {
    id: "btn-shine",
    name: "Shine Button",
    author: "satyamchaudharydev",
    html: `<button class="btn-shine-uv">\n  Apply Now\n  <svg class="btn-shine-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>\n</button>`,
    css: `.btn-shine-uv {\n  position: relative;\n  transition: all 0.3s ease-in-out;\n  box-shadow: 0px 10px 20px rgba(0, 0, 0, 0.2);\n  padding: 0.5rem 1.25rem;\n  background-color: rgb(0 107 179);\n  border-radius: 9999px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: #fff;\n  gap: 10px;\n  font-weight: bold;\n  border: 3px solid #ffffff4d;\n  outline: none;\n  overflow: hidden;\n  font-size: 15px;\n  cursor: pointer;\n}\n.btn-shine-icon {\n  width: 24px;\n  height: 24px;\n  transition: all 0.3s ease-in-out;\n}\n.btn-shine-uv:hover {\n  transform: scale(1.05);\n  border-color: #fff9;\n}\n.btn-shine-uv:hover .btn-shine-icon {\n  transform: translateX(4px);\n}\n.btn-shine-uv:hover::before {\n  animation: btn-shine-anim 1.5s ease-out infinite;\n}\n.btn-shine-uv::before {\n  content: "";\n  position: absolute;\n  width: 100px;\n  height: 100%;\n  background-image: linear-gradient(120deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.8), rgba(255,255,255,0) 70%);\n  top: 0;\n  left: -100px;\n  opacity: 0.6;\n}\n@keyframes btn-shine-anim {\n  0% { left: -100px; }\n  60% { left: 100%; }\n  to { left: 100%; }\n}`,
  },
  {
    id: "btn-bookmark",
    name: "Bookmark Button",
    author: "vinodjangid07",
    html: `<button class="bookmarkBtn-uv">\n  <span class="IconContainer-uv">\n    <svg viewBox="0 0 384 512" height="0.9em" class="icon-bookmark-uv"><path d="M0 48V487.7C0 501.1 10.9 512 24.3 512c5 0 9.9-1.5 14-4.4L192 400 345.7 507.6c4.1 2.9 9 4.4 14 4.4 13.4 0 24.3-10.9 24.3-24.3V48c0-26.5-21.5-48-48-48H48C21.5 0 0 21.5 0 48z" fill="white"></path></svg>\n  </span>\n  <span class="text-bookmark-uv">Save</span>\n</button>`,
    css: `.bookmarkBtn-uv {\n  width: 100px;\n  height: 40px;\n  border-radius: 40px;\n  border: 1px solid rgba(255, 255, 255, 0.349);\n  background-color: rgb(12, 12, 12);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  transition-duration: 0.3s;\n  overflow: hidden;\n}\n.IconContainer-uv {\n  width: 30px;\n  height: 30px;\n  background: linear-gradient(to bottom, rgb(255, 136, 255), rgb(172, 70, 255));\n  border-radius: 50px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  overflow: hidden;\n  z-index: 2;\n  transition-duration: 0.3s;\n}\n.icon-bookmark-uv {\n  border-radius: 1px;\n}\n.text-bookmark-uv {\n  height: 100%;\n  width: 60px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: white;\n  z-index: 1;\n  transition-duration: 0.3s;\n  font-size: 1.04em;\n}\n.bookmarkBtn-uv:hover .IconContainer-uv {\n  width: 90px;\n  transition-duration: 0.3s;\n}\n.bookmarkBtn-uv:hover .text-bookmark-uv {\n  transform: translate(10px);\n  width: 0;\n  font-size: 0;\n  transition-duration: 0.3s;\n}\n.bookmarkBtn-uv:active {\n  transform: scale(0.95);\n  transition-duration: 0.3s;\n}`,
  },
  {
    id: "btn-rainbow",
    name: "Rainbow 3D Button",
    author: "JkHuger",
    html: `<button class="rainbow-hover-uv">\n  <span class="sp-uv">Register</span>\n</button>`,
    css: `.rainbow-hover-uv {\n  font-size: 16px;\n  font-weight: 700;\n  color: #ff7576;\n  background-color: #2B3044;\n  border: none;\n  outline: none;\n  cursor: pointer;\n  padding: 12px 24px;\n  position: relative;\n  line-height: 24px;\n  border-radius: 9px;\n  box-shadow: 0px 1px 2px #2B3044, 0px 4px 16px #2B3044;\n  transform-style: preserve-3d;\n  transform: scale(var(--s, 1)) perspective(600px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));\n  perspective: 600px;\n  transition: transform 0.1s;\n}\n.sp-uv {\n  background: linear-gradient(90deg, #866ee7, #ea60da, #ed8f57, #fbd41d, #2cca91);\n  -webkit-background-clip: text;\n  -webkit-text-fill-color: transparent;\n  background-clip: text;\n  display: block;\n}\n.rainbow-hover-uv:active {\n  transition: 0.3s;\n  transform: scale(0.93);\n}`,
  },
  {
    id: "btn-golden",
    name: "Golden Button",
    author: "elijahgummer",
    html: `<button class="golden-button-uv">Golden</button>`,
    css: `.golden-button-uv {\n  touch-action: manipulation;\n  display: inline-block;\n  outline: none;\n  font-family: inherit;\n  font-size: 1em;\n  box-sizing: border-box;\n  border: none;\n  border-radius: 0.3em;\n  height: 2.75em;\n  line-height: 2.5em;\n  text-transform: uppercase;\n  padding: 0 1em;\n  box-shadow: 0 3px 6px rgba(0,0,0,.16), 0 3px 6px rgba(110,80,20,.4), inset 0 -2px 5px 1px rgba(139,66,8,1), inset 0 -1px 1px 3px rgba(250,227,133,1);\n  background-image: linear-gradient(160deg, #a54e07, #b47e11, #fef1a2, #bc881b, #a54e07);\n  border: 1px solid #a55d07;\n  color: rgb(120, 50, 5);\n  text-shadow: 0 2px 2px rgba(250, 227, 133, 1);\n  cursor: pointer;\n  transition: all 0.2s ease-in-out;\n  background-size: 100% 100%;\n  background-position: center;\n  font-weight: 700;\n}\n.golden-button-uv:focus,\n.golden-button-uv:hover {\n  background-size: 150% 150%;\n  box-shadow: 0 10px 20px rgba(0,0,0,.19), 0 6px 6px rgba(0,0,0,.23), inset 0 -2px 5px 1px #b17d10, inset 0 -1px 1px 3px rgba(250,227,133,1);\n  border: 1px solid rgba(165,93,7,.6);\n  color: rgba(120,50,5,.8);\n}\n.golden-button-uv:active {\n  box-shadow: 0 3px 6px rgba(0,0,0,.16), 0 3px 6px rgba(110,80,20,.4), inset 0 -2px 5px 1px #b17d10, inset 0 -1px 1px 3px rgba(250,227,133,1);\n}`,
  },
  {
    id: "btn-purple-gradient",
    name: "Purple Gradient",
    author: "bandirevanth",
    html: `<button class="custom-btn-uv btn-1-uv">Click me</button>`,
    css: `.custom-btn-uv {\n  width: 130px;\n  height: 40px;\n  color: #fff;\n  border-radius: 5px;\n  padding: 10px 25px;\n  font-weight: 500;\n  background: transparent;\n  cursor: pointer;\n  transition: all 0.3s ease;\n  position: relative;\n  display: inline-block;\n  box-shadow: inset 2px 2px 2px 0px rgba(255,255,255,.5), 7px 7px 20px 0px rgba(0,0,0,.1), 4px 4px 5px 0px rgba(0,0,0,.1);\n  outline: none;\n  border: none;\n}\n.btn-1-uv {\n  background: linear-gradient(0deg, rgba(96,9,240,1) 0%, rgba(129,5,240,1) 100%);\n}\n.btn-1-uv:hover {\n  box-shadow: 4px 4px 6px 0 rgba(255,255,255,.5), -4px -4px 6px 0 rgba(116,125,136,.5), inset -4px -4px 6px 0 rgba(255,255,255,.2), inset 4px 4px 6px 0 rgba(0,0,0,.4);\n}`,
  },
  {
    id: "btn-skew-fill",
    name: "Skew Fill Button",
    author: "Ali-Tahmazi99",
    html: `<button class="skew-btn-uv"><span class="skew-text-uv">Hover me</span></button>`,
    css: `.skew-btn-uv {\n  display: inline-block;\n  width: 150px;\n  height: 50px;\n  border-radius: 10px;\n  border: 1px solid #03045e;\n  position: relative;\n  overflow: hidden;\n  transition: all 0.5s ease-in;\n  z-index: 1;\n  background: transparent;\n  cursor: pointer;\n}\n.skew-btn-uv::before,\n.skew-btn-uv::after {\n  content: '';\n  position: absolute;\n  top: 0;\n  width: 0;\n  height: 100%;\n  transform: skew(15deg);\n  transition: all 0.5s;\n  overflow: hidden;\n  z-index: -1;\n}\n.skew-btn-uv::before {\n  left: -10px;\n  background: #240046;\n}\n.skew-btn-uv::after {\n  right: -10px;\n  background: #5a189a;\n}\n.skew-btn-uv:hover::before,\n.skew-btn-uv:hover::after {\n  width: 58%;\n}\n.skew-btn-uv:hover .skew-text-uv {\n  color: #e0aaff;\n  transition: 0.3s;\n}\n.skew-text-uv {\n  color: #03045e;\n  font-size: 18px;\n  transition: all 0.3s ease-in;\n}`,
  },
  {
    id: "btn-blue-icon",
    name: "Blue Icon Button",
    author: "SpatexDEV",
    html: `<button class="blue-btn-uv">\n  <svg class="blue-btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>\n  UPLOAD\n</button>`,
    css: `.blue-btn-uv {\n  border: none;\n  display: flex;\n  padding: 0.75rem 1.5rem;\n  background-color: #488aec;\n  color: #ffffff;\n  font-size: 0.75rem;\n  line-height: 1rem;\n  font-weight: 700;\n  text-align: center;\n  cursor: pointer;\n  text-transform: uppercase;\n  vertical-align: middle;\n  align-items: center;\n  border-radius: 0.5rem;\n  user-select: none;\n  gap: 0.75rem;\n  box-shadow: 0 4px 6px -1px #488aec31, 0 2px 4px -1px #488aec17;\n  transition: all 0.6s ease;\n}\n.blue-btn-svg {\n  width: 1.25rem;\n  height: 1.25rem;\n}\n.blue-btn-uv:hover {\n  box-shadow: 0 10px 15px -3px #488aec4f, 0 4px 6px -2px #488aec17;\n}\n.blue-btn-uv:focus,\n.blue-btn-uv:active {\n  opacity: 0.85;\n  box-shadow: none;\n}`,
  },
  {
    id: "btn-line-hover",
    name: "Line Hover Button",
    author: "portseif",
    html: `<button class="line-hover-uv">Explore</button>`,
    css: `.line-hover-uv {\n  align-items: center;\n  background-color: transparent;\n  color: #fff;\n  cursor: pointer;\n  display: flex;\n  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;\n  font-size: 1rem;\n  font-weight: 700;\n  line-height: 1.5;\n  text-decoration: none;\n  text-transform: uppercase;\n  outline: 0;\n  border: 0;\n  padding: 1rem;\n}\n.line-hover-uv::before {\n  background-color: #fff;\n  content: "";\n  display: inline-block;\n  height: 1px;\n  margin-right: 10px;\n  transition: all .42s cubic-bezier(.25,.8,.25,1);\n  width: 0;\n}\n.line-hover-uv:hover::before {\n  background-color: #fff;\n  width: 3rem;\n}`,
  },
  {
    id: "btn-playstore",
    name: "App Store Button",
    author: "Yaya12085",
    html: `<a class="playstore-btn-uv" href="#">\n  <svg class="playstore-icon-uv" viewBox="0 0 384 512" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>\n  <span class="playstore-texts-uv">\n    <span class="playstore-text1-uv">Download on the</span>\n    <span class="playstore-text2-uv">App Store</span>\n  </span>\n</a>`,
    css: `.playstore-btn-uv {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  border: 2px solid #000;\n  border-radius: 9999px;\n  background-color: rgba(0, 0, 0, 1);\n  padding: 0.625rem 1.5rem;\n  text-align: center;\n  color: rgba(255, 255, 255, 1);\n  outline: 0;\n  transition: all .2s ease;\n  text-decoration: none;\n  cursor: pointer;\n}\n.playstore-btn-uv:hover {\n  background-color: transparent;\n  color: rgba(0, 0, 0, 1);\n}\n.playstore-icon-uv {\n  height: 1.5rem;\n  width: 1.5rem;\n}\n.playstore-texts-uv {\n  margin-left: 1rem;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  line-height: 1;\n}\n.playstore-text1-uv {\n  margin-bottom: 0.25rem;\n  font-size: 0.75rem;\n  line-height: 1rem;\n}\n.playstore-text2-uv {\n  font-weight: 600;\n  font-size: 1rem;\n}`,
  },
  {
    id: "btn-seemore",
    name: "See More Glow",
    author: "Javierrocadev",
    html: `<button class="seemore-uv">See more</button>`,
    css: `.seemore-uv {\n  position: relative;\n  background: #262626;\n  height: 4rem;\n  width: 16rem;\n  border: 1px solid #404040;\n  text-align: left;\n  padding: 0.75rem;\n  color: #fafafa;\n  font-size: 1rem;\n  font-weight: 700;\n  border-radius: 0.5rem;\n  overflow: hidden;\n  cursor: pointer;\n  text-decoration: underline;\n  text-underline-offset: 2px;\n  transition: all 0.5s ease;\n  font-family: system-ui, sans-serif;\n}\n.seemore-uv::before {\n  content: "";\n  position: absolute;\n  right: 0.25rem;\n  top: 0.25rem;\n  z-index: 10;\n  width: 3rem;\n  height: 3rem;\n  background: #8b5cf6;\n  border-radius: 9999px;\n  filter: blur(16px);\n  transition: all 0.5s ease;\n}\n.seemore-uv::after {\n  content: "";\n  position: absolute;\n  z-index: 10;\n  width: 5rem;\n  height: 5rem;\n  background: #fda4af;\n  right: 2rem;\n  top: 0.75rem;\n  border-radius: 9999px;\n  filter: blur(16px);\n  transition: all 0.5s ease;\n}\n.seemore-uv:hover {\n  border-color: #fda4af;\n  color: #fda4af;\n  text-underline-offset: 4px;\n  text-decoration-thickness: 2px;\n}\n.seemore-uv:hover::before {\n  right: 3rem;\n  bottom: -2rem;\n  filter: blur(24px);\n  box-shadow: 20px 20px 20px 30px #a21caf;\n}\n.seemore-uv:hover::after {\n  right: -2rem;\n}`,
  },
  {
    id: "btn-getstarted",
    name: "Gradient Glow CTA",
    author: "shivam_7937",
    html: `<div class="getstarted-wrap-uv">\n  <div class="getstarted-glow-uv"></div>\n  <a class="getstarted-btn-uv" href="#">Get Started For Free<svg viewBox="0 0 10 10" height="10" width="10"><path d="M0 5h7" class="arrow-line-uv"></path><path d="M1 1l4 4-4 4" class="arrow-head-uv"></path></svg></a>\n</div>`,
    css: `.getstarted-wrap-uv {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n}\n.getstarted-glow-uv {\n  position: absolute;\n  inset: 0;\n  opacity: 0.6;\n  transition: all 1s ease;\n  background: linear-gradient(to right, #6366f1, #ec4899, #facc15);\n  border-radius: 0.75rem;\n  filter: blur(16px);\n}\n.getstarted-wrap-uv:hover .getstarted-glow-uv {\n  opacity: 1;\n  transition-duration: 0.2s;\n}\n.getstarted-btn-uv {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 0.9rem;\n  border-radius: 0.75rem;\n  background: #111827;\n  padding: 0.75rem 1.5rem;\n  font-weight: 600;\n  color: white;\n  transition: all 0.2s ease;\n  border: none;\n  cursor: pointer;\n  text-decoration: none;\n  font-family: system-ui, sans-serif;\n}\n.getstarted-btn-uv:hover {\n  background: #1f2937;\n  box-shadow: 0 10px 15px -3px rgba(75,85,99,0.3);\n  transform: translateY(-1px);\n}\n.getstarted-btn-uv svg {\n  margin-top: 2px;\n  margin-left: 0.5rem;\n  margin-right: -0.25rem;\n  stroke: white;\n  stroke-width: 2;\n  fill: none;\n}\n.arrow-line-uv {\n  transition: opacity 0.2s;\n  opacity: 0;\n}\n.getstarted-btn-uv:hover .arrow-line-uv {\n  opacity: 1;\n}\n.arrow-head-uv {\n  transition: transform 0.2s;\n}\n.getstarted-btn-uv:hover .arrow-head-uv {\n  transform: translateX(3px);\n}`,
  },
  {
    id: "btn-gradient-border",
    name: "Gradient Border",
    author: "Spacious74",
    html: `<div class="gradborder-wrap-uv">\n  <button class="gradborder-btn-uv">Button</button>\n</div>`,
    css: `.gradborder-wrap-uv {\n  position: relative;\n  padding: 3px;\n  background: linear-gradient(90deg, #03a9f4, #f441a5);\n  border-radius: 0.9em;\n  transition: all 0.4s ease;\n}\n.gradborder-wrap-uv::before {\n  content: "";\n  position: absolute;\n  inset: 0;\n  margin: auto;\n  border-radius: 0.9em;\n  z-index: -1;\n  filter: blur(0);\n  transition: filter 0.4s ease;\n}\n.gradborder-wrap-uv:hover::before {\n  background: linear-gradient(90deg, #03a9f4, #f441a5);\n  filter: blur(1.2em);\n}\n.gradborder-wrap-uv:active::before {\n  filter: blur(0.2em);\n}\n.gradborder-btn-uv {\n  font-size: 1.4em;\n  padding: 0.6em 0.8em;\n  border-radius: 0.5em;\n  border: none;\n  background-color: #000;\n  color: #fff;\n  cursor: pointer;\n  box-shadow: 2px 2px 3px #000000b4;\n  font-family: system-ui, sans-serif;\n}`,
  },
  {
    id: "btn-3d-press",
    name: "3D Press Button",
    author: "FColombati",
    html: `<div class="fc-button-uv">\n  <div class="fc-button-outer-uv">\n    <div class="fc-button-inner-uv">\n      <span>Click me</span>\n    </div>\n  </div>\n</div>`,
    css: `.fc-button-uv {\n  all: unset;\n  cursor: pointer;\n  -webkit-tap-highlight-color: rgba(0,0,0,0);\n  position: relative;\n  border-radius: 100em;\n  background-color: rgba(0,0,0,0.75);\n  box-shadow: -0.15em -0.15em 0.15em -0.075em rgba(5,5,5,0.25), 0.0375em 0.0375em 0.0675em 0 rgba(5,5,5,0.1);\n}\n.fc-button-uv::after {\n  content: "";\n  position: absolute;\n  z-index: 0;\n  width: calc(100% + 0.3em);\n  height: calc(100% + 0.3em);\n  top: -0.15em;\n  left: -0.15em;\n  border-radius: inherit;\n  background: linear-gradient(-135deg, rgba(5,5,5,0.5), transparent 20%, transparent 100%);\n  filter: blur(0.0125em);\n  opacity: 0.25;\n  mix-blend-mode: multiply;\n}\n.fc-button-outer-uv {\n  position: relative;\n  z-index: 1;\n  border-radius: inherit;\n  transition: box-shadow 300ms ease;\n  will-change: box-shadow;\n  box-shadow: 0 0.05em 0.05em -0.01em rgba(5,5,5,1), 0 0.01em 0.01em -0.01em rgba(5,5,5,0.5), 0.15em 0.3em 0.1em -0.01em rgba(5,5,5,0.25);\n}\n.fc-button-uv:hover .fc-button-outer-uv {\n  box-shadow: 0 0 0 0 rgba(5,5,5,1), 0 0 0 0 rgba(5,5,5,0.5), 0 0 0 0 rgba(5,5,5,0.25);\n}\n.fc-button-inner-uv {\n  position: relative;\n  z-index: 1;\n  border-radius: inherit;\n  padding: 1em 1.5em;\n  background-image: linear-gradient(135deg, rgba(230,230,230,1), rgba(180,180,180,1));\n  transition: box-shadow 300ms ease, clip-path 250ms ease, background-image 250ms ease, transform 250ms ease;\n  will-change: box-shadow, clip-path, background-image, transform;\n  overflow: clip;\n  clip-path: inset(0 0 0 0 round 100em);\n  box-shadow: 0 0 0 0 inset rgba(5,5,5,0.1), -0.05em -0.05em 0.05em 0 inset rgba(5,5,5,0.25), 0 0 0 0 inset rgba(5,5,5,0.1), 0 0 0.05em 0.2em inset rgba(255,255,255,0.25), 0.025em 0.05em 0.1em 0 inset rgba(255,255,255,1), 0.12em 0.12em 0.12em inset rgba(255,255,255,0.25), -0.075em -0.25em 0.25em 0.1em inset rgba(5,5,5,0.25);\n}\n.fc-button-uv:hover .fc-button-inner-uv {\n  clip-path: inset(clamp(1px,0.0625em,2px) clamp(1px,0.0625em,2px) clamp(1px,0.0625em,2px) clamp(1px,0.0625em,2px) round 100em);\n  box-shadow: 0.1em 0.15em 0.05em 0 inset rgba(5,5,5,0.75), -0.025em -0.03em 0.05em 0.025em inset rgba(5,5,5,0.5), 0.25em 0.25em 0.2em 0 inset rgba(5,5,5,0.5), 0 0 0.05em 0.5em inset rgba(255,255,255,0.15), 0 0 0 0 inset rgba(255,255,255,1), 0.12em 0.12em 0.12em inset rgba(255,255,255,0.25), -0.075em -0.12em 0.2em 0.1em inset rgba(5,5,5,0.25);\n}\n.fc-button-inner-uv span {\n  position: relative;\n  z-index: 4;\n  font-family: "Inter", sans-serif;\n  letter-spacing: -0.05em;\n  font-weight: 500;\n  color: rgba(0,0,0,0);\n  background-image: linear-gradient(135deg, rgba(25,25,25,1), rgba(75,75,75,1));\n  -webkit-background-clip: text;\n  background-clip: text;\n  transition: transform 250ms ease;\n  display: block;\n  will-change: transform;\n  text-shadow: rgba(0,0,0,0.1) 0 0 0.1em;\n  user-select: none;\n}\n.fc-button-uv:hover .fc-button-inner-uv span {\n  transform: scale(0.975);\n}\n.fc-button-uv:active .fc-button-inner-uv {\n  transform: scale(0.975);\n}`,
  },
];

const CATEGORIES: { key: UITemplateCategory; label: string; icon: string }[] = [
  { key: "buttons", label: "Кнопки", icon: "🔘" },
  { key: "cards", label: "Карточки", icon: "🃏" },
  { key: "toggles", label: "Переключатели", icon: "🔀" },
  { key: "loaders", label: "Загрузка", icon: "⏳" },
  { key: "forms", label: "Формы", icon: "📝" },
];

function getTemplatesForCategory(cat: UITemplateCategory): UITemplate[] {
  switch (cat) {
    case "buttons": return BUTTON_TEMPLATES;
    default: return [];
  }
}

function TemplatePreviewCard({ t, onInsert }: { t: UITemplate; onInsert: (html: string, css: string) => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hovered, setHovered] = useState(false);

  const triggerHover = useCallback((enter: boolean) => {
    setHovered(enter);
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return;
    const allEls = iframe.contentDocument.querySelectorAll("button, a, div, .bookmarkBtn-uv, .rainbow-hover-uv, .golden-button-uv, .custom-btn-uv, .skew-btn-uv, .blue-btn-uv, .line-hover-uv, .playstore-btn-uv, .btn-shine-uv, .seemore-uv, .getstarted-wrap-uv, .getstarted-btn-uv, .gradborder-wrap-uv, .fc-button-uv");
    allEls.forEach((el) => {
      if (enter) {
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        (el as HTMLElement).classList.add("hover");
      } else {
        el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        (el as HTMLElement).classList.remove("hover");
      }
    });
  }, []);

  const previewHtml = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{height:100%;overflow:hidden;}body{display:flex;align-items:center;justify-content:center;min-height:100%;background:#212121;font-family:system-ui,sans-serif;}${t.css.replace(/:hover/g, ':hover,.hover')}</style></head><body>${t.html}</body></html>`;

  return (
    <div
      className="group relative rounded-xl overflow-hidden cursor-pointer"
      style={{ background: '#212121', border: hovered ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(255,255,255,0.06)', transition: 'border-color 0.2s' }}
      onClick={() => onInsert(t.html, t.css)}
      onMouseEnter={() => triggerHover(true)}
      onMouseLeave={() => triggerHover(false)}
      data-testid={`template-${t.id}`}
    >
      <div style={{ height: 160, overflow: 'hidden', position: 'relative' }}>
        <iframe
          ref={iframeRef}
          srcDoc={previewHtml}
          style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
          sandbox="allow-scripts allow-same-origin"
          title={t.name}
        />
      </div>
      <div style={{ padding: '0.6rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'rgba(255,255,255,0.5)' }}>{t.author}</span>
        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', gap: 4 }}>
          &lt;/&gt; Get code
        </span>
      </div>
    </div>
  );
}

interface UITemplatesModalProps {
  open: boolean;
  onClose: () => void;
  onInsert: (html: string, css: string) => void;
}

export function UITemplatesModal({ open, onClose, onInsert }: UITemplatesModalProps) {
  const [activeCategory, setActiveCategory] = useState<UITemplateCategory>("buttons");
  const templates = getTemplatesForCategory(activeCategory);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="p-0 !grid-rows-[1fr] [&>button:last-child]:hidden" style={{ maxWidth: 1060, height: '82vh', borderRadius: 24, border: '1px solid rgba(255,255,255,0.08)', background: '#0a0a0f', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif', overflow: 'hidden' }}>
        <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
          <div style={{ width: 190, borderRight: '1px solid rgba(255,255,255,0.06)', padding: '1.5rem 0', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '0 1.25rem 1.25rem', fontSize: '1.1rem', fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
              Шаблоны UI
            </div>
            <div className="flex flex-col gap-0.5" style={{ padding: '0 0.5rem' }}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  data-testid={`template-cat-${cat.key}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.6rem 0.75rem', borderRadius: 12, border: 'none',
                    background: activeCategory === cat.key ? 'rgba(255,255,255,0.08)' : 'transparent',
                    color: activeCategory === cat.key ? '#fff' : 'rgba(255,255,255,0.45)',
                    fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.2s',
                  }}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                  {CATEGORIES.find(c => c.key === activeCategory)?.label}
                </h3>
                <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', margin: '0.2rem 0 0' }}>
                  {templates.length > 0 ? `${templates.length} шаблонов` : 'Скоро'}
                </p>
              </div>
              <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }} data-testid="button-close-templates">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
              {templates.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', paddingBottom: '1rem' }}>
                  {templates.map((t) => (
                    <TemplatePreviewCard key={t.id} t={t} onInsert={onInsert} />
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: 'rgba(255,255,255,0.3)' }}>
                  <span style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🚧</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Раздел в разработке</span>
                  <span style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Шаблоны для этой категории скоро появятся</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

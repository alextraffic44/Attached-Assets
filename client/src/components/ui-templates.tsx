import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X } from "lucide-react";

export type UITemplateCategory = "buttons" | "cards" | "toggles" | "loaders" | "forms";

export interface UITemplate {
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
  {
    id: "btn-neon-green",
    name: "Neon Glow",
    author: "adamgiebl",
    html: `<button class="neon-btn-uv">Neon</button>`,
    css: `.neon-btn-uv {\n  font-size: 1rem;\n  padding: 0.7em 1.4em;\n  font-weight: 600;\n  background: transparent;\n  border: 2px solid #0aff0a;\n  color: #0aff0a;\n  border-radius: 0.4em;\n  cursor: pointer;\n  text-transform: uppercase;\n  letter-spacing: 0.1em;\n  transition: 0.3s;\n  box-shadow: inset 0 0 0.5em 0 #0aff0a, 0 0 0.5em 0 #0aff0a;\n  position: relative;\n  font-family: system-ui, sans-serif;\n}\n.neon-btn-uv::before {\n  content: "";\n  position: absolute;\n  background: #0aff0a;\n  inset: 2px;\n  border-radius: 0.2em;\n  opacity: 0;\n  transition: 0.3s;\n  z-index: -1;\n}\n.neon-btn-uv:hover {\n  color: #000;\n  box-shadow: inset 0 0 0.5em 0 #0aff0a, 0 0 1.5em 0 #0aff0a;\n}\n.neon-btn-uv:hover::before {\n  opacity: 1;\n}`,
  },
  {
    id: "btn-cyber",
    name: "Cyber Button",
    author: "Jedi-hongbin",
    html: `<button class="cyber-btn-uv">Cyber<span class="cyber-glitch-uv">_</span></button>`,
    css: `.cyber-btn-uv {\n  background: #f0c;\n  color: #fff;\n  font-family: system-ui, sans-serif;\n  font-size: 1rem;\n  font-weight: 700;\n  text-transform: uppercase;\n  padding: 0.6em 1.2em;\n  border: none;\n  cursor: pointer;\n  position: relative;\n  clip-path: polygon(0 0, 100% 0, 100% 70%, 92% 100%, 0 100%);\n  letter-spacing: 0.1em;\n  transition: background 0.3s;\n}\n.cyber-btn-uv:hover {\n  background: #e600b3;\n}\n.cyber-btn-uv::before {\n  content: "";\n  position: absolute;\n  bottom: 2px;\n  right: 0;\n  width: 30%;\n  height: 30%;\n  background: #000;\n  clip-path: polygon(20% 0, 100% 0, 100% 100%, 0 100%);\n  transition: 0.3s;\n}\n.cyber-glitch-uv {\n  animation: cyber-glitch 0.5s steps(2) infinite;\n}\n@keyframes cyber-glitch {\n  0% { opacity: 1; }\n  50% { opacity: 0; }\n}`,
  },
  {
    id: "btn-send-msg",
    name: "Send Message",
    author: "cssbuttons-io",
    html: `<button class="send-btn-uv">\n  <span class="send-text-uv">Send</span>\n  <span class="send-icon-uv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></span>\n</button>`,
    css: `.send-btn-uv {\n  display: flex;\n  align-items: center;\n  gap: 0.5rem;\n  padding: 0.65rem 1.4rem;\n  border: none;\n  border-radius: 50px;\n  background: linear-gradient(135deg, #6366f1, #8b5cf6);\n  color: #fff;\n  font-size: 0.95rem;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all 0.3s;\n  font-family: system-ui, sans-serif;\n}\n.send-icon-uv {\n  display: flex;\n  width: 18px;\n  height: 18px;\n  transition: transform 0.3s;\n}\n.send-icon-uv svg { width: 100%; height: 100%; }\n.send-btn-uv:hover {\n  transform: translateY(-2px);\n  box-shadow: 0 8px 20px rgba(99,102,241,0.4);\n}\n.send-btn-uv:hover .send-icon-uv {\n  transform: translateX(4px) translateY(-2px);\n}`,
  },
  {
    id: "btn-slide-right",
    name: "Slide Fill",
    author: "mrhyddenn",
    html: `<button class="slidefill-uv"><span>Hover me</span></button>`,
    css: `.slidefill-uv {\n  position: relative;\n  display: inline-block;\n  padding: 12px 28px;\n  border: 2px solid #fff;\n  color: #fff;\n  background: transparent;\n  font-size: 0.95rem;\n  font-weight: 600;\n  cursor: pointer;\n  overflow: hidden;\n  transition: color 0.4s;\n  border-radius: 6px;\n  font-family: system-ui, sans-serif;\n  z-index: 1;\n}\n.slidefill-uv::before {\n  content: "";\n  position: absolute;\n  top: 0;\n  left: -100%;\n  width: 100%;\n  height: 100%;\n  background: #fff;\n  transition: left 0.4s ease;\n  z-index: -1;\n}\n.slidefill-uv:hover {\n  color: #000;\n}\n.slidefill-uv:hover::before {\n  left: 0;\n}`,
  },
  {
    id: "btn-pulse-ring",
    name: "Pulse Ring",
    author: "zanina-yassine",
    html: `<button class="pulse-ring-uv">Click</button>`,
    css: `.pulse-ring-uv {\n  position: relative;\n  padding: 12px 30px;\n  background: #7c3aed;\n  color: #fff;\n  border: none;\n  border-radius: 50px;\n  font-size: 0.95rem;\n  font-weight: 600;\n  cursor: pointer;\n  transition: transform 0.2s;\n  font-family: system-ui, sans-serif;\n}\n.pulse-ring-uv::before {\n  content: "";\n  position: absolute;\n  inset: -4px;\n  border-radius: 50px;\n  border: 2px solid #7c3aed;\n  opacity: 0;\n  animation: pulse-ring-anim 2s infinite;\n}\n@keyframes pulse-ring-anim {\n  0% { opacity: 1; transform: scale(1); }\n  100% { opacity: 0; transform: scale(1.15); }\n}\n.pulse-ring-uv:hover {\n  transform: scale(1.05);\n}`,
  },
  {
    id: "btn-glitch",
    name: "Glitch Button",
    author: "Pradeepsaranbishnoi",
    html: `<button class="glitch-btn-uv" data-text="GLITCH">GLITCH</button>`,
    css: `.glitch-btn-uv {\n  position: relative;\n  padding: 12px 28px;\n  background: #000;\n  color: #0ff;\n  border: 2px solid #0ff;\n  font-size: 1rem;\n  font-weight: 700;\n  text-transform: uppercase;\n  letter-spacing: 0.15em;\n  cursor: pointer;\n  font-family: monospace;\n  transition: 0.3s;\n}\n.glitch-btn-uv:hover {\n  background: #0ff;\n  color: #000;\n  box-shadow: 0 0 10px #0ff, 0 0 40px #0ff, 0 0 80px #0ff;\n  animation: glitch-skew 0.5s infinite;\n}\n@keyframes glitch-skew {\n  0% { transform: skew(0deg); }\n  20% { transform: skew(-2deg); }\n  40% { transform: skew(1deg); }\n  60% { transform: skew(-1deg); }\n  80% { transform: skew(2deg); }\n  100% { transform: skew(0deg); }\n}`,
  },
  {
    id: "btn-delete-confirm",
    name: "Delete Slide",
    author: "guilhermevialle",
    html: `<button class="del-btn-uv">\n  <svg class="del-icon-uv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V3h6v3"/></svg>\n  Delete\n</button>`,
    css: `.del-btn-uv {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 20px;\n  background: #1a1a1a;\n  color: #f87171;\n  border: 1px solid #f8717133;\n  border-radius: 10px;\n  font-size: 0.9rem;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all 0.3s;\n  font-family: system-ui, sans-serif;\n}\n.del-icon-uv { width: 18px; height: 18px; transition: transform 0.3s; }\n.del-btn-uv:hover {\n  background: #f87171;\n  color: #fff;\n  border-color: #f87171;\n  box-shadow: 0 4px 15px rgba(248,113,113,0.3);\n}\n.del-btn-uv:hover .del-icon-uv { transform: scale(1.15); }`,
  },
  {
    id: "btn-github-star",
    name: "Star on GitHub",
    author: "itsKrish01",
    html: `<button class="gh-star-uv">\n  <svg class="gh-star-icon-uv" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>\n  Star on Github\n</button>`,
    css: `.gh-star-uv {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 20px;\n  background: #21262d;\n  color: #c9d1d9;\n  border: 1px solid #30363d;\n  border-radius: 8px;\n  font-size: 0.85rem;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all 0.2s;\n  font-family: system-ui, sans-serif;\n}\n.gh-star-icon-uv {\n  width: 16px; height: 16px;\n  color: #e3b341;\n  transition: transform 0.3s;\n}\n.gh-star-uv:hover {\n  background: #30363d;\n  border-color: #6e7681;\n}\n.gh-star-uv:hover .gh-star-icon-uv {\n  transform: scale(1.3) rotate(15deg);\n}`,
  },
  {
    id: "btn-animated-border",
    name: "Animated Border",
    author: "Nawsome",
    html: `<button class="anim-border-uv"><span>Click me</span></button>`,
    css: `.anim-border-uv {\n  position: relative;\n  padding: 12px 28px;\n  background: #111;\n  color: #fff;\n  border: none;\n  border-radius: 8px;\n  font-size: 0.95rem;\n  font-weight: 600;\n  cursor: pointer;\n  overflow: hidden;\n  z-index: 1;\n  font-family: system-ui, sans-serif;\n}\n.anim-border-uv::before {\n  content: "";\n  position: absolute;\n  top: -50%;\n  left: -50%;\n  width: 200%;\n  height: 200%;\n  background: conic-gradient(transparent, #7c3aed, transparent 30%);\n  animation: anim-border-spin 3s linear infinite;\n  z-index: -2;\n}\n.anim-border-uv::after {\n  content: "";\n  position: absolute;\n  inset: 2px;\n  background: #111;\n  border-radius: 6px;\n  z-index: -1;\n}\n@keyframes anim-border-spin {\n  to { transform: rotate(360deg); }\n}`,
  },
  {
    id: "btn-google-login",
    name: "Google Login",
    author: "nicolo.ribaudo",
    html: `<button class="google-btn-uv">\n  <svg class="google-icon-uv" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>\n  Continue with Google\n</button>`,
    css: `.google-btn-uv {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 20px;\n  background: #fff;\n  color: #3c4043;\n  border: 1px solid #dadce0;\n  border-radius: 8px;\n  font-size: 0.9rem;\n  font-weight: 500;\n  cursor: pointer;\n  transition: all 0.2s;\n  font-family: system-ui, sans-serif;\n}\n.google-icon-uv { width: 20px; height: 20px; }\n.google-btn-uv:hover {\n  background: #f7f8f8;\n  box-shadow: 0 1px 3px rgba(0,0,0,0.15);\n}`,
  },
  {
    id: "btn-download",
    name: "Download",
    author: "barisdogrusoz",
    html: `<button class="dl-btn-uv">\n  <svg class="dl-icon-uv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>\n  Download\n</button>`,
    css: `.dl-btn-uv {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 12px 24px;\n  background: linear-gradient(135deg, #059669, #10b981);\n  color: #fff;\n  border: none;\n  border-radius: 10px;\n  font-size: 0.9rem;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all 0.3s;\n  font-family: system-ui, sans-serif;\n}\n.dl-icon-uv { width: 18px; height: 18px; transition: transform 0.3s; }\n.dl-btn-uv:hover {\n  transform: translateY(-2px);\n  box-shadow: 0 6px 20px rgba(16,185,129,0.4);\n}\n.dl-btn-uv:hover .dl-icon-uv { transform: translateY(3px); }`,
  },
  {
    id: "btn-subscribe",
    name: "Subscribe",
    author: "Smit-Prajapati",
    html: `<button class="subscribe-uv">\n  <span class="subscribe-text-uv">Subscribe</span>\n  <span class="subscribe-ring-uv">\n    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>\n  </span>\n</button>`,
    css: `.subscribe-uv {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 22px;\n  background: #ef4444;\n  color: #fff;\n  border: none;\n  border-radius: 50px;\n  font-size: 0.9rem;\n  font-weight: 700;\n  cursor: pointer;\n  transition: all 0.3s;\n  font-family: system-ui, sans-serif;\n}\n.subscribe-ring-uv {\n  display: flex;\n  width: 18px;\n  height: 18px;\n}\n.subscribe-ring-uv svg { width: 100%; height: 100%; }\n.subscribe-uv:hover {\n  background: #dc2626;\n  transform: scale(1.05);\n}\n.subscribe-uv:hover .subscribe-ring-uv {\n  animation: bell-ring 0.5s ease;\n}\n@keyframes bell-ring {\n  0% { transform: rotate(0); }\n  25% { transform: rotate(15deg); }\n  50% { transform: rotate(-15deg); }\n  75% { transform: rotate(10deg); }\n  100% { transform: rotate(0); }\n}`,
  },
  {
    id: "btn-flip-card",
    name: "Flip Button",
    author: "Yaya12085",
    html: `<button class="flip-btn-uv">\n  <span class="flip-front-uv">Hover me</span>\n  <span class="flip-back-uv">Click!</span>\n</button>`,
    css: `.flip-btn-uv {\n  position: relative;\n  width: 120px;\n  height: 42px;\n  perspective: 600px;\n  background: transparent;\n  border: none;\n  cursor: pointer;\n}\n.flip-front-uv, .flip-back-uv {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border-radius: 8px;\n  font-size: 0.9rem;\n  font-weight: 600;\n  backface-visibility: hidden;\n  transition: transform 0.5s;\n  font-family: system-ui, sans-serif;\n}\n.flip-front-uv {\n  background: #6366f1;\n  color: #fff;\n}\n.flip-back-uv {\n  background: #ec4899;\n  color: #fff;\n  transform: rotateX(180deg);\n}\n.flip-btn-uv:hover .flip-front-uv {\n  transform: rotateX(-180deg);\n}\n.flip-btn-uv:hover .flip-back-uv {\n  transform: rotateX(0);\n}`,
  },
  {
    id: "btn-outline-fill",
    name: "Outline to Fill",
    author: "alexmaracinaru",
    html: `<button class="outline-fill-uv">Get Started</button>`,
    css: `.outline-fill-uv {\n  padding: 12px 28px;\n  border: 2px solid #6366f1;\n  background: transparent;\n  color: #6366f1;\n  font-size: 0.95rem;\n  font-weight: 600;\n  border-radius: 8px;\n  cursor: pointer;\n  position: relative;\n  overflow: hidden;\n  transition: color 0.4s, border-color 0.4s;\n  z-index: 1;\n  font-family: system-ui, sans-serif;\n}\n.outline-fill-uv::before {\n  content: "";\n  position: absolute;\n  bottom: 0;\n  left: 0;\n  width: 100%;\n  height: 0;\n  background: #6366f1;\n  transition: height 0.4s ease;\n  z-index: -1;\n}\n.outline-fill-uv:hover {\n  color: #fff;\n}\n.outline-fill-uv:hover::before {\n  height: 100%;\n}`,
  },
  {
    id: "btn-swipe-right",
    name: "Swipe Arrow",
    author: "cssbuttons-io",
    html: `<button class="swipe-btn-uv">\n  <span>Swipe</span>\n  <svg class="swipe-arrow-uv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>\n</button>`,
    css: `.swipe-btn-uv {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 12px 20px;\n  background: #18181b;\n  color: #fff;\n  border: 1px solid #27272a;\n  border-radius: 10px;\n  font-size: 0.95rem;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all 0.3s;\n  font-family: system-ui, sans-serif;\n}\n.swipe-arrow-uv {\n  width: 18px; height: 18px;\n  transition: transform 0.3s;\n}\n.swipe-btn-uv:hover {\n  background: #27272a;\n  padding-right: 26px;\n}\n.swipe-btn-uv:hover .swipe-arrow-uv {\n  transform: translateX(5px);\n}`,
  },
  {
    id: "btn-gradient-text",
    name: "Gradient Text",
    author: "Nawsome",
    html: `<button class="grad-text-uv">Explore Now</button>`,
    css: `.grad-text-uv {\n  padding: 12px 28px;\n  background: transparent;\n  border: 2px solid transparent;\n  border-image: linear-gradient(135deg, #667eea, #764ba2) 1;\n  color: #fff;\n  font-size: 0.95rem;\n  font-weight: 700;\n  cursor: pointer;\n  position: relative;\n  font-family: system-ui, sans-serif;\n  background-image: linear-gradient(#111, #111), linear-gradient(135deg, #667eea, #764ba2);\n  background-origin: border-box;\n  background-clip: padding-box, border-box;\n  transition: all 0.3s;\n}\n.grad-text-uv:hover {\n  background-image: linear-gradient(135deg, #667eea, #764ba2), linear-gradient(135deg, #667eea, #764ba2);\n  background-clip: padding-box, border-box;\n  color: #fff;\n  box-shadow: 0 4px 15px rgba(102,126,234,0.3);\n}`,
  },
  {
    id: "btn-minimal-dark",
    name: "Minimal Dark",
    author: "TaniaDou",
    html: `<button class="minimal-dark-uv">Button</button>`,
    css: `.minimal-dark-uv {\n  padding: 12px 28px;\n  background: #0ea5e9;\n  color: #fff;\n  border: none;\n  border-radius: 8px;\n  font-size: 0.9rem;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all 0.3s;\n  box-shadow: 0 2px 10px rgba(14,165,233,0.3);\n  font-family: system-ui, sans-serif;\n}\n.minimal-dark-uv:hover {\n  background: #0284c7;\n  transform: translateY(-2px);\n  box-shadow: 0 6px 20px rgba(14,165,233,0.4);\n}\n.minimal-dark-uv:active {\n  transform: translateY(0);\n  box-shadow: 0 2px 5px rgba(14,165,233,0.3);\n}`,
  },
  {
    id: "btn-brutalist",
    name: "Brutalist",
    author: "martinval11",
    html: `<button class="brutal-btn-uv">Click me</button>`,
    css: `.brutal-btn-uv {\n  padding: 12px 28px;\n  background: #fff;\n  color: #000;\n  border: 3px solid #000;\n  font-size: 0.95rem;\n  font-weight: 700;\n  cursor: pointer;\n  box-shadow: 4px 4px 0 #000;\n  transition: all 0.15s;\n  text-transform: uppercase;\n  font-family: system-ui, sans-serif;\n}\n.brutal-btn-uv:hover {\n  box-shadow: 2px 2px 0 #000;\n  transform: translate(2px, 2px);\n}\n.brutal-btn-uv:active {\n  box-shadow: 0 0 0 #000;\n  transform: translate(4px, 4px);\n}`,
  },
  {
    id: "btn-morph",
    name: "Soft Morph",
    author: "sahilxkhadka",
    html: `<button class="morph-btn-uv">Click</button>`,
    css: `.morph-btn-uv {\n  padding: 14px 32px;\n  background: #e0e5ec;\n  border: none;\n  border-radius: 12px;\n  color: #555;\n  font-size: 0.95rem;\n  font-weight: 600;\n  cursor: pointer;\n  box-shadow: 6px 6px 12px #b8bec7, -6px -6px 12px #fff;\n  transition: all 0.2s;\n  font-family: system-ui, sans-serif;\n}\n.morph-btn-uv:hover {\n  box-shadow: 4px 4px 8px #b8bec7, -4px -4px 8px #fff;\n}\n.morph-btn-uv:active {\n  box-shadow: inset 4px 4px 8px #b8bec7, inset -4px -4px 8px #fff;\n}`,
  },
  {
    id: "btn-loading-dots",
    name: "Loading Dots",
    author: "vineethtrv",
    html: `<button class="dots-btn-uv">\n  <span class="dots-text-uv">Submit</span>\n  <span class="dots-loading-uv"><span></span><span></span><span></span></span>\n</button>`,
    css: `.dots-btn-uv {\n  position: relative;\n  padding: 12px 32px;\n  background: #3b82f6;\n  color: #fff;\n  border: none;\n  border-radius: 8px;\n  font-size: 0.9rem;\n  font-weight: 600;\n  cursor: pointer;\n  font-family: system-ui, sans-serif;\n  overflow: hidden;\n  min-width: 120px;\n  transition: all 0.3s;\n}\n.dots-text-uv { transition: opacity 0.3s; }\n.dots-loading-uv {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 4px;\n  opacity: 0;\n  transition: opacity 0.3s;\n}\n.dots-loading-uv span {\n  width: 6px; height: 6px;\n  background: #fff;\n  border-radius: 50%;\n  animation: dots-bounce 0.6s infinite alternate;\n}\n.dots-loading-uv span:nth-child(2) { animation-delay: 0.2s; }\n.dots-loading-uv span:nth-child(3) { animation-delay: 0.4s; }\n@keyframes dots-bounce {\n  to { transform: translateY(-6px); opacity: 0.5; }\n}\n.dots-btn-uv:hover .dots-text-uv { opacity: 0; }\n.dots-btn-uv:hover .dots-loading-uv { opacity: 1; }`,
  },
  {
    id: "btn-copy-code",
    name: "Copy Code",
    author: "adamgiebl",
    html: `<button class="copy-btn-uv">\n  <svg class="copy-icon-uv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>\n  Copy\n</button>`,
    css: `.copy-btn-uv {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 8px 16px;\n  background: #27272a;\n  color: #a1a1aa;\n  border: 1px solid #3f3f46;\n  border-radius: 6px;\n  font-size: 0.8rem;\n  font-weight: 500;\n  cursor: pointer;\n  transition: all 0.2s;\n  font-family: monospace;\n}\n.copy-icon-uv { width: 14px; height: 14px; }\n.copy-btn-uv:hover {\n  background: #3f3f46;\n  color: #fff;\n  border-color: #52525b;\n}`,
  },
  {
    id: "btn-shine-border",
    name: "Shine Border",
    author: "Yaya12085",
    html: `<button class="shine-border-uv">Premium</button>`,
    css: `.shine-border-uv {\n  position: relative;\n  padding: 12px 28px;\n  background: #111;\n  color: #fff;\n  border: 1px solid #333;\n  border-radius: 50px;\n  font-size: 0.9rem;\n  font-weight: 600;\n  cursor: pointer;\n  overflow: hidden;\n  font-family: system-ui, sans-serif;\n  transition: border-color 0.3s;\n}\n.shine-border-uv::before {\n  content: "";\n  position: absolute;\n  top: -50%;\n  left: -50%;\n  width: 200%;\n  height: 200%;\n  background: linear-gradient(transparent, transparent 40%, rgba(255,255,255,0.15) 50%, transparent 60%, transparent);\n  transform: rotate(45deg);\n  animation: shine-sweep 3s ease-in-out infinite;\n}\n@keyframes shine-sweep {\n  0% { transform: translateX(-100%) rotate(45deg); }\n  50%, 100% { transform: translateX(100%) rotate(45deg); }\n}\n.shine-border-uv:hover {\n  border-color: #666;\n}`,
  },
  {
    id: "btn-gradient-hover",
    name: "Gradient Shift",
    author: "Pradeepsaranbishnoi",
    html: `<button class="grad-shift-uv">Hover me</button>`,
    css: `.grad-shift-uv {\n  padding: 12px 28px;\n  border: none;\n  border-radius: 8px;\n  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n  background-size: 200% 200%;\n  background-position: 0% 50%;\n  color: #fff;\n  font-size: 0.95rem;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all 0.5s ease;\n  font-family: system-ui, sans-serif;\n}\n.grad-shift-uv:hover {\n  background-position: 100% 50%;\n  transform: translateY(-2px);\n  box-shadow: 0 8px 25px rgba(102,126,234,0.35);\n}`,
  },
  {
    id: "btn-play",
    name: "Play Button",
    author: "catraco",
    html: `<button class="play-btn-uv">\n  <svg class="play-icon-uv" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>\n</button>`,
    css: `.play-btn-uv {\n  width: 56px;\n  height: 56px;\n  border-radius: 50%;\n  background: linear-gradient(135deg, #6366f1, #a855f7);\n  border: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  transition: all 0.3s;\n  box-shadow: 0 4px 15px rgba(99,102,241,0.4);\n}\n.play-icon-uv {\n  width: 22px; height: 22px;\n  color: #fff;\n  margin-left: 3px;\n  transition: transform 0.3s;\n}\n.play-btn-uv:hover {\n  transform: scale(1.1);\n  box-shadow: 0 6px 25px rgba(99,102,241,0.5);\n}\n.play-btn-uv:hover .play-icon-uv {\n  transform: scale(1.1);\n}`,
  },
  {
    id: "btn-read-more",
    name: "Read More",
    author: "vinodjangid07",
    html: `<button class="readmore-uv">\n  Read More\n  <svg class="readmore-arr-uv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>\n</button>`,
    css: `.readmore-uv {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 10px 20px;\n  background: linear-gradient(135deg, #7c3aed, #a855f7);\n  color: #fff;\n  border: none;\n  border-radius: 6px;\n  font-size: 0.85rem;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all 0.3s;\n  font-family: system-ui, sans-serif;\n}\n.readmore-arr-uv {\n  width: 16px; height: 16px;\n  transition: transform 0.3s;\n}\n.readmore-uv:hover {\n  gap: 10px;\n  box-shadow: 0 4px 15px rgba(124,58,237,0.4);\n}\n.readmore-uv:hover .readmore-arr-uv {\n  transform: translateX(4px);\n}`,
  },
  {
    id: "btn-3d-shadow",
    name: "3D Shadow",
    author: "Smit-Prajapati",
    html: `<button class="shadow3d-uv">Push me</button>`,
    css: `.shadow3d-uv {\n  padding: 12px 28px;\n  background: #4f46e5;\n  color: #fff;\n  border: none;\n  border-radius: 10px;\n  font-size: 0.95rem;\n  font-weight: 700;\n  cursor: pointer;\n  box-shadow: 0 6px 0 #3730a3;\n  transition: all 0.15s;\n  transform: translateY(0);\n  font-family: system-ui, sans-serif;\n}\n.shadow3d-uv:hover {\n  box-shadow: 0 4px 0 #3730a3;\n  transform: translateY(2px);\n}\n.shadow3d-uv:active {\n  box-shadow: 0 1px 0 #3730a3;\n  transform: translateY(5px);\n}`,
  },
  {
    id: "btn-notify-bell",
    name: "Notify Me",
    author: "zanina-yassine",
    html: `<button class="notify-uv">\n  <svg class="notify-bell-uv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>\n  Notify me\n</button>`,
    css: `.notify-uv {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 20px;\n  background: #18181b;\n  color: #fbbf24;\n  border: 1px solid #fbbf2433;\n  border-radius: 10px;\n  font-size: 0.85rem;\n  font-weight: 600;\n  cursor: pointer;\n  transition: all 0.3s;\n  font-family: system-ui, sans-serif;\n}\n.notify-bell-uv { width: 16px; height: 16px; transition: transform 0.3s; }\n.notify-uv:hover {\n  background: #fbbf24;\n  color: #000;\n  border-color: #fbbf24;\n}\n.notify-uv:hover .notify-bell-uv {\n  animation: bell-shake 0.4s ease;\n  stroke: #000;\n}\n@keyframes bell-shake {\n  0%, 100% { transform: rotate(0); }\n  25% { transform: rotate(12deg); }\n  50% { transform: rotate(-12deg); }\n  75% { transform: rotate(8deg); }\n}`,
  },
  {
    id: "btn-sparkle-generate",
    name: "Sparkle Button",
    author: "MuhammadHasann",
    html: `<button class="sparkle-gen-uv">\n  <span class="sparkle-border-uv"></span>\n  <svg class="sparkle-svg-uv" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z"/></svg>\n  Generate\n</button>`,
    css: `.sparkle-gen-uv {\n  cursor: pointer;\n  position: relative;\n  display: flex;\n  align-items: center;\n  gap: 0.5rem;\n  padding: 1rem 2rem;\n  background-color: transparent;\n  border: none;\n  border-radius: 9999px;\n  color: #fff;\n  font-size: 0.95rem;\n  font-weight: 600;\n  font-family: system-ui, sans-serif;\n  z-index: 1;\n  transition: transform 0.3s;\n}\n.sparkle-gen-uv::before {\n  content: "";\n  position: absolute;\n  inset: 0;\n  background-color: hsl(0 0% 12%);\n  border-radius: 9999px;\n  box-shadow: inset 0 0.5px #fff3, inset 0 -1px 2px #000, 0 4px 10px -4px #0008;\n  z-index: -1;\n  transition: box-shadow 0.3s;\n}\n.sparkle-gen-uv::after {\n  content: "";\n  position: absolute;\n  inset: 0;\n  background: hsla(260 97% 61% / 0.75);\n  background-image: radial-gradient(at 51% 89%, hsla(266,45%,74%,1) 0, transparent 50%), radial-gradient(at 100% 100%, hsla(266,36%,60%,1) 0, transparent 50%);\n  border-radius: 9999px;\n  opacity: 0;\n  transition: opacity 0.3s;\n  z-index: -1;\n}\n.sparkle-gen-uv:hover::before {\n  box-shadow: inset 0 0.5px #fff3, inset 0 -1px 2px #000, 0 0 0 0.375rem hsla(260,97%,50%,0.75);\n}\n.sparkle-gen-uv:hover::after {\n  opacity: 1;\n}\n.sparkle-border-uv {\n  position: absolute;\n  inset: -1px;\n  border-radius: 9999px;\n  overflow: hidden;\n  z-index: -2;\n}\n.sparkle-border-uv::before {\n  content: "";\n  position: absolute;\n  top: 30%;\n  left: 50%;\n  width: 100%;\n  height: 2rem;\n  background: white;\n  mask: linear-gradient(transparent, white 120%);\n  animation: sparkle-rotate-uv 2s linear infinite;\n}\n@keyframes sparkle-rotate-uv {\n  to { transform: rotate(360deg); }\n}\n.sparkle-svg-uv {\n  width: 1.25rem;\n  height: 1.25rem;\n  animation: sparkle-pulse-uv 1s ease infinite alternate;\n}\n@keyframes sparkle-pulse-uv {\n  to { transform: scale(1.2); opacity: 0.7; }\n}`,
  },
  {
    id: "btn-batman-mask",
    name: "Batman Play",
    author: "barisdogansutcu",
    html: `<button class="batman-btn-uv"><span>PLAY NOW</span></button>`,
    css: `.batman-btn-uv {\n  border: none;\n  position: relative;\n  width: 200px;\n  height: 73px;\n  padding: 0;\n  z-index: 2;\n  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' height='868' width='2500' viewBox='0 0 726 252.17'%3E%3Cpath d='M483.92 0S481.38 24.71 466 40.11c-11.74 11.74-24.09 12.66-40.26 15.07-9.42 1.41-29.7 3.77-34.81-.79-2.37-2.11-3-21-3.22-27.62-.21-6.92-1.36-16.52-2.82-18-.75 3.06-2.49 11.53-3.09 13.61S378.49 34.3 378 36a85.13 85.13 0 0 0-30.09 0c-.46-1.67-3.17-11.48-3.77-13.56s-2.34-10.55-3.09-13.61c-1.45 1.45-2.61 11.05-2.82 18-.21 6.67-.84 25.51-3.22 27.62-5.11 4.56-25.38 2.2-34.8.79-16.16-2.47-28.51-3.39-40.21-15.13C244.57 24.71 242 0 242 0H0s69.52 22.74 97.52 68.59c16.56 27.11 14.14 58.49 9.92 74.73C170 140 221.46 140 273 158.57c69.23 24.93 83.2 76.19 90 93.6 6.77-17.41 20.75-68.67 90-93.6 51.54-18.56 103-18.59 165.56-15.25-4.21-16.24-6.63-47.62 9.93-74.73C656.43 22.74 726 0 726 0z'/%3E%3C/svg%3E") no-repeat 50% 50%;\n  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' height='868' width='2500' viewBox='0 0 726 252.17'%3E%3Cpath d='M483.92 0S481.38 24.71 466 40.11c-11.74 11.74-24.09 12.66-40.26 15.07-9.42 1.41-29.7 3.77-34.81-.79-2.37-2.11-3-21-3.22-27.62-.21-6.92-1.36-16.52-2.82-18-.75 3.06-2.49 11.53-3.09 13.61S378.49 34.3 378 36a85.13 85.13 0 0 0-30.09 0c-.46-1.67-3.17-11.48-3.77-13.56s-2.34-10.55-3.09-13.61c-1.45 1.45-2.61 11.05-2.82 18-.21 6.67-.84 25.51-3.22 27.62-5.11 4.56-25.38 2.2-34.8.79-16.16-2.47-28.51-3.39-40.21-15.13C244.57 24.71 242 0 242 0H0s69.52 22.74 97.52 68.59c16.56 27.11 14.14 58.49 9.92 74.73C170 140 221.46 140 273 158.57c69.23 24.93 83.2 76.19 90 93.6 6.77-17.41 20.75-68.67 90-93.6 51.54-18.56 103-18.59 165.56-15.25-4.21-16.24-6.63-47.62 9.93-74.73C656.43 22.74 726 0 726 0z'/%3E%3C/svg%3E") no-repeat 50% 50%;\n  -webkit-mask-size: 100%;\n  mask-size: 100%;\n  cursor: pointer;\n  background-color: transparent;\n  transform: translateY(8px);\n}\n.batman-btn-uv::after {\n  content: '';\n  position: absolute;\n  left: 0;\n  right: 0;\n  bottom: 0;\n  box-shadow: 0 0 0 0 white;\n  transition: all 2s ease;\n}\n.batman-btn-uv:hover::after {\n  box-shadow: 0 -13px 56px 12px #ffffffa6;\n}\n.batman-btn-uv span {\n  position: absolute;\n  width: 100%;\n  font-size: 15px;\n  font-weight: 100;\n  left: 50%;\n  top: 39%;\n  letter-spacing: 3px;\n  text-align: center;\n  transform: translate(-50%, -50%);\n  color: black;\n  transition: all 2s ease;\n  font-family: system-ui, sans-serif;\n}\n.batman-btn-uv:hover span {\n  color: white;\n}\n.batman-btn-uv::before {\n  content: '';\n  position: absolute;\n  width: 0;\n  height: 100%;\n  background-color: black;\n  left: 50%;\n  top: 50%;\n  transform: translate(-50%, -50%);\n  transition: all 1s ease;\n}\n.batman-btn-uv:hover::before {\n  width: 100%;\n}`,
  },
  {
    id: "btn-autumn-leaf",
    name: "Autumn Leaf",
    author: "MuhammadHasann",
    html: `<button class="autumn-btn-uv">\n  <svg class="leaf1-uv" viewBox="0 0 24 24" fill="#e67e22"><path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66L7 19l2-2 2 1 2-1 2 2 1.27 3 1.89-.66C20.1 16.17 17.9 10 17 8z"/></svg>\n  <svg class="leaf2-uv" viewBox="0 0 24 24" fill="#f39c12"><path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66L7 19l2-2 2 1 2-1 2 2 1.27 3 1.89-.66C20.1 16.17 17.9 10 17 8z"/></svg>\n  <svg class="leaf3-uv" viewBox="0 0 24 24" fill="#d35400"><path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66L7 19l2-2 2 1 2-1 2 2 1.27 3 1.89-.66C20.1 16.17 17.9 10 17 8z"/></svg>\n  Button\n</button>`,
    css: `.autumn-btn-uv {\n  position: relative;\n  padding: 15px 45px;\n  background: #fec195;\n  font-size: 17px;\n  font-weight: 500;\n  color: #181818;\n  cursor: pointer;\n  border: 1px solid #fec195;\n  border-radius: 8px;\n  filter: drop-shadow(2px 2px 3px rgba(0,0,0,0.2));\n  font-family: system-ui, sans-serif;\n  transition: all 0.3s;\n}\n.autumn-btn-uv:hover {\n  border-color: #f3b182;\n  background: linear-gradient(85deg, #fec195, #fcc196, #fabd92, #fac097, #fac39c);\n}\n.leaf1-uv {\n  position: absolute;\n  top: 0;\n  right: 0;\n  width: 25px;\n  transform-origin: 0 0;\n  transform: rotate(10deg);\n  transition: all 0.5s;\n  filter: drop-shadow(2px 2px 3px rgba(0,0,0,0.3));\n}\n.autumn-btn-uv:hover .leaf1-uv {\n  animation: leaf-sway1-uv 3s cubic-bezier(0.52,0,0.58,1) infinite;\n}\n@keyframes leaf-sway1-uv {\n  0%, 100% { transform: rotate(10deg); }\n  50% { transform: rotate(-5deg); }\n}\n.leaf2-uv {\n  position: absolute;\n  top: 0;\n  left: 25px;\n  width: 12px;\n  transform-origin: 50% 0;\n  transform: rotate(10deg);\n  transition: all 1s;\n  filter: drop-shadow(2px 2px 3px rgba(0,0,0,0.5));\n}\n.autumn-btn-uv:hover .leaf2-uv {\n  animation: leaf-sway2-uv 3s cubic-bezier(0.52,0,0.58,1) 1s infinite;\n}\n@keyframes leaf-sway2-uv {\n  0%, 100% { transform: rotate(0deg); }\n  50% { transform: rotate(15deg); }\n}\n.leaf3-uv {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: 18px;\n  transform-origin: 50% 0;\n  transform: rotate(-5deg);\n  transition: all 1s;\n  filter: drop-shadow(2px 2px 3px rgba(0,0,0,0.5));\n}\n.autumn-btn-uv:hover .leaf3-uv {\n  animation: leaf-sway3-uv 2s cubic-bezier(0.52,0,0.58,1) 1s infinite;\n}\n@keyframes leaf-sway3-uv {\n  0%, 100% { transform: rotate(0deg); }\n  50% { transform: rotate(-5deg); }\n}`,
  },
  {
    id: "btn-aurora-circles",
    name: "Aurora Button",
    author: "Ashon-G",
    html: `<button class="aurora-btn-uv">\n  <span class="aurora-wrap-uv">\n    <span>UIVERSE</span>\n    <span class="aurora-c1-uv"></span>\n    <span class="aurora-c2-uv"></span>\n    <span class="aurora-c3-uv"></span>\n    <span class="aurora-c4-uv"></span>\n  </span>\n</button>`,
    css: `.aurora-btn-uv {\n  -webkit-appearance: none;\n  outline: none;\n  position: relative;\n  cursor: pointer;\n  border: none;\n  display: table;\n  border-radius: 24px;\n  padding: 0;\n  margin: 0;\n  text-align: center;\n  font-weight: 600;\n  font-size: 16px;\n  letter-spacing: 0.02em;\n  line-height: 1.5;\n  color: #fff;\n  background: radial-gradient(circle, #ffd215, #fff172 80%);\n  box-shadow: 0 0 14px rgba(255,223,87,0.5);\n  font-family: system-ui, sans-serif;\n}\n.aurora-btn-uv::before {\n  content: "";\n  pointer-events: none;\n  position: absolute;\n  z-index: 3;\n  inset: 0;\n  border-radius: 24px;\n  box-shadow: inset 0 3px 12px rgba(255,223,52,0.9), inset 0 -3px 4px rgba(255,250,215,0.8);\n}\n.aurora-wrap-uv {\n  overflow: hidden;\n  border-radius: 24px;\n  min-width: 132px;\n  padding: 12px 24px;\n  display: block;\n  position: relative;\n}\n.aurora-wrap-uv span:first-child {\n  position: relative;\n  z-index: 1;\n}\n.aurora-c1-uv, .aurora-c2-uv, .aurora-c3-uv, .aurora-c4-uv {\n  position: absolute;\n  width: 40px;\n  height: 40px;\n  border-radius: 50%;\n  filter: blur(8px);\n}\n.aurora-c1-uv {\n  background: rgba(255,232,26,0.7);\n  top: -10px;\n  left: 10px;\n  animation: aurora-move1-uv 3s ease infinite;\n}\n.aurora-c2-uv {\n  background: rgba(255,163,26,0.7);\n  top: 0;\n  right: 10px;\n  animation: aurora-move2-uv 4s ease infinite;\n}\n.aurora-c3-uv {\n  background: #1a23ff;\n  filter: blur(14px);\n  bottom: -5px;\n  left: 40%;\n  animation: aurora-move3-uv 3.5s ease infinite;\n}\n.aurora-c4-uv {\n  background: #e21bda;\n  filter: blur(16px);\n  bottom: 0;\n  right: 20px;\n  animation: aurora-move4-uv 5s ease infinite;\n}\n.aurora-btn-uv:hover .aurora-c1-uv, .aurora-btn-uv:hover .aurora-c2-uv, .aurora-btn-uv:hover .aurora-c3-uv, .aurora-btn-uv:hover .aurora-c4-uv {\n  animation-duration: 1.4s;\n}\n@keyframes aurora-move1-uv {\n  0%, 100% { transform: translate(0, 0); }\n  50% { transform: translate(30px, 15px); }\n}\n@keyframes aurora-move2-uv {\n  0%, 100% { transform: translate(0, 0); }\n  50% { transform: translate(-20px, 10px); }\n}\n@keyframes aurora-move3-uv {\n  0%, 100% { transform: translate(0, 0); }\n  50% { transform: translate(15px, -10px); }\n}\n@keyframes aurora-move4-uv {\n  0%, 100% { transform: translate(0, 0); }\n  50% { transform: translate(-15px, -15px); }\n}`,
  },
  {
    id: "btn-gradient-rotate",
    name: "Gradient Rotate",
    author: "gharsh11032000",
    html: `<button class="gradrot-btn-uv">Button</button>`,
    css: `.gradrot-btn-uv {\n  position: relative;\n  width: 120px;\n  height: 40px;\n  background-color: #000;\n  display: flex;\n  align-items: center;\n  color: white;\n  justify-content: center;\n  border: none;\n  padding: 12px;\n  border-radius: 8px;\n  cursor: pointer;\n  font-size: 0.9rem;\n  font-weight: 600;\n  font-family: system-ui, sans-serif;\n  z-index: 1;\n}\n.gradrot-btn-uv::before {\n  content: '';\n  position: absolute;\n  inset: -4px;\n  margin: auto;\n  width: 128px;\n  height: 48px;\n  border-radius: 10px;\n  background: linear-gradient(-45deg, #e81cff 0%, #40c9ff 100%);\n  z-index: -2;\n  pointer-events: none;\n  transition: all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);\n}\n.gradrot-btn-uv::after {\n  content: "";\n  z-index: -1;\n  position: absolute;\n  inset: 0;\n  background: linear-gradient(-45deg, #fc00ff 0%, #00dbde 100%);\n  transform: translate3d(0,0,0) scale(0.95);\n  filter: blur(20px);\n  border-radius: 8px;\n}\n.gradrot-btn-uv:hover::after {\n  filter: blur(30px);\n}\n.gradrot-btn-uv:hover::before {\n  transform: rotate(-180deg);\n}\n.gradrot-btn-uv:active::before {\n  scale: 0.7;\n}`,
  },
  {
    id: "btn-gplay-round",
    name: "Google Play Round",
    author: "Yaya12085",
    html: `<a class="gplay-round-uv" href="#">\n  <svg class="gplay-icon-uv" viewBox="0 0 512 512" fill="currentColor"><path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/></svg>\n  <span class="gplay-texts-uv">\n    <span class="gplay-t1-uv">GET IT ON</span>\n    <span class="gplay-t2-uv">Google Play</span>\n  </span>\n</a>`,
    css: `.gplay-round-uv {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  border: 2px solid #000;\n  border-radius: 9999px;\n  background-color: #000;\n  padding: 0.625rem 1.5rem;\n  text-align: center;\n  color: #fff;\n  text-decoration: none;\n  transition: all 0.2s ease;\n  font-family: system-ui, sans-serif;\n}\n.gplay-round-uv:hover {\n  background-color: transparent;\n  color: #000;\n}\n.gplay-icon-uv {\n  height: 1.5rem;\n  width: 1.5rem;\n}\n.gplay-texts-uv {\n  margin-left: 1rem;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  line-height: 1;\n}\n.gplay-t1-uv {\n  margin-bottom: 0.25rem;\n  font-size: 0.75rem;\n}\n.gplay-t2-uv {\n  font-weight: 600;\n  font-size: 0.95rem;\n}`,
  },
];
const CARD_TEMPLATES: UITemplate[] = [
  {
    id: "card-gradient-glow",
    name: "Gradient Glow",
    author: "Tiagoadag",
    html: `<div class="card-glow-uv">\n  <div class="card2-glow-uv">\n    <p style="color:#fff;font-family:system-ui;padding:20px;font-size:0.85rem;">Hover me</p>\n  </div>\n</div>`,
    css: `.card-glow-uv {\n  width: 190px;\n  height: 254px;\n  background-image: linear-gradient(163deg, #00ff75 0%, #3700ff 100%);\n  border-radius: 20px;\n  transition: all .3s;\n}\n.card2-glow-uv {\n  width: 190px;\n  height: 254px;\n  background-color: #1a1a1a;\n  border-radius: 0;\n  transition: all .2s;\n}\n.card2-glow-uv:hover {\n  transform: scale(0.98);\n  border-radius: 20px;\n}\n.card-glow-uv:hover {\n  box-shadow: 0px 0px 30px 1px rgba(0, 255, 117, 0.30);\n}`,
  },
  {
    id: "card-flip-circles",
    name: "Flip Circles",
    author: "ElSombrero2",
    html: `<div class="flipc-card-uv">\n  <div class="flipc-content-uv">\n    <div class="flipc-back-uv">\n      <div class="flipc-back-content-uv">\n        <div class="flipc-circle-uv" id="flipc-bottom-uv"></div>\n        <div class="flipc-circle-uv" id="flipc-right-uv"></div>\n        <strong style="font-size:1.1rem;">Hover Card</strong>\n        <span style="font-size:0.75rem;color:#999;">Flip effect</span>\n      </div>\n    </div>\n    <div class="flipc-front-uv">\n      <div class="flipc-front-content-uv">\n        <div class="flipc-badge-uv">Featured</div>\n        <div class="flipc-description-uv">\n          <div class="flipc-title-uv">\n            <p>Beautiful</p>\n            <p>Card</p>\n          </div>\n          <p class="flipc-footer-uv">Hover to flip</p>\n        </div>\n      </div>\n    </div>\n  </div>\n</div>`,
    css: `.flipc-card-uv {\n  overflow: visible;\n  width: 190px;\n  height: 254px;\n}\n.flipc-content-uv {\n  width: 100%;\n  height: 100%;\n  transform-style: preserve-3d;\n  transition: transform 300ms;\n  box-shadow: 0px 0px 10px 1px #000000ee;\n  border-radius: 5px;\n}\n.flipc-front-uv, .flipc-back-uv {\n  background-color: #151515;\n  position: absolute;\n  width: 100%;\n  height: 100%;\n  backface-visibility: hidden;\n  -webkit-backface-visibility: hidden;\n  border-radius: 5px;\n  overflow: hidden;\n}\n.flipc-back-uv {\n  width: 100%;\n  height: 100%;\n  justify-content: center;\n  display: flex;\n  align-items: center;\n  overflow: hidden;\n}\n.flipc-back-uv::before {\n  position: absolute;\n  content: '';\n  display: block;\n  width: 160px;\n  height: 160%;\n  background: linear-gradient(90deg, transparent, #ff9966, #ff9966, #ff9966, #ff9966, transparent);\n  animation: flipc-rotation-uv 5000ms infinite linear;\n}\n.flipc-back-content-uv {\n  position: absolute;\n  width: 99%;\n  height: 99%;\n  background-color: #151515;\n  border-radius: 5px;\n  color: white;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  gap: 30px;\n  font-family: system-ui, sans-serif;\n}\n.flipc-card-uv:hover .flipc-content-uv {\n  transform: rotateY(180deg);\n}\n@keyframes flipc-rotation-uv {\n  0% { transform: rotateZ(0deg); }\n  100% { transform: rotateZ(360deg); }\n}\n.flipc-front-uv {\n  transform: rotateY(180deg);\n  color: white;\n}\n.flipc-front-content-uv {\n  position: absolute;\n  width: 100%;\n  height: 100%;\n  padding: 10px;\n  display: flex;\n  flex-direction: column;\n  justify-content: space-between;\n  font-family: system-ui, sans-serif;\n}\n.flipc-badge-uv {\n  background-color: #00000055;\n  padding: 2px 10px;\n  border-radius: 10px;\n  backdrop-filter: blur(2px);\n  width: fit-content;\n  font-size: 0.7rem;\n}\n.flipc-description-uv {\n  box-shadow: 0px 0px 10px 5px #00000088;\n  width: 100%;\n  padding: 10px;\n  background-color: #00000099;\n  backdrop-filter: blur(5px);\n  border-radius: 5px;\n}\n.flipc-title-uv {\n  font-size: 11px;\n  max-width: 100%;\n  display: flex;\n  justify-content: space-between;\n}\n.flipc-title-uv p { width: 50%; }\n.flipc-footer-uv {\n  color: #ffffff88;\n  margin-top: 5px;\n  font-size: 8px;\n}\n.flipc-circle-uv {\n  width: 90px;\n  height: 90px;\n  border-radius: 50%;\n  background-color: #ffbb66;\n  position: relative;\n  filter: blur(15px);\n  animation: flipc-floating-uv 2600ms infinite linear;\n}\n#flipc-bottom-uv {\n  background-color: #ff8866;\n  left: 50px;\n  top: 0px;\n  width: 150px;\n  height: 150px;\n  animation-delay: -800ms;\n}\n#flipc-right-uv {\n  background-color: #ff2233;\n  left: 160px;\n  top: -80px;\n  width: 30px;\n  height: 30px;\n  animation-delay: -1800ms;\n}\n@keyframes flipc-floating-uv {\n  0% { transform: translateY(0px); }\n  50% { transform: translateY(10px); }\n  100% { transform: translateY(0px); }\n}`,
  },
  {
    id: "card-credit-flip",
    name: "Credit Card Flip",
    author: "Praashoo7",
    html: `<div class="creditcard-uv">\n  <div class="creditcard-inner-uv">\n    <div class="creditcard-front-uv">\n      <p class="creditcard-heading-uv">VISA</p>\n      <svg class="creditcard-chip-uv" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" width="36"><rect x="1" y="8" width="46" height="32" rx="6" fill="#ffd700" stroke="#daa520" stroke-width="1.5"/><line x1="1" y1="20" x2="47" y2="20" stroke="#daa520" stroke-width="1.5"/><line x1="1" y1="28" x2="47" y2="28" stroke="#daa520" stroke-width="1.5"/><line x1="16" y1="8" x2="16" y2="40" stroke="#daa520" stroke-width="1.5"/><line x1="32" y1="8" x2="32" y2="40" stroke="#daa520" stroke-width="1.5"/></svg>\n      <p class="creditcard-number-uv">9865  7532  4810  2197</p>\n      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:auto">\n        <div>\n          <p class="creditcard-validlbl-uv">VALID THRU</p>\n          <p class="creditcard-date-uv">05/28</p>\n        </div>\n        <p class="creditcard-name-uv">JOHN DOE</p>\n      </div>\n    </div>\n    <div class="creditcard-back-uv">\n      <div class="creditcard-strip-uv"></div>\n      <div class="creditcard-mstrip-uv"><span class="creditcard-code-uv">123</span></div>\n    </div>\n  </div>\n</div>`,
    css: `.creditcard-uv {\n  background-color: transparent;\n  width: 240px;\n  height: 154px;\n  perspective: 1000px;\n  color: white;\n  font-family: system-ui, sans-serif;\n}\n.creditcard-inner-uv {\n  position: relative;\n  width: 100%;\n  height: 100%;\n  text-align: center;\n  transition: transform 0.8s;\n  transform-style: preserve-3d;\n}\n.creditcard-uv:hover .creditcard-inner-uv {\n  transform: rotateY(180deg);\n}\n.creditcard-front-uv, .creditcard-back-uv {\n  box-shadow: rgba(0,0,0,0.4) 0px 2px 2px, rgba(0,0,0,0.3) 0px 7px 13px -3px, rgba(0,0,0,0.2) 0px -1px 0px inset;\n  position: absolute;\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n  height: 100%;\n  -webkit-backface-visibility: hidden;\n  backface-visibility: hidden;\n  border-radius: 1rem;\n  padding: 16px;\n  box-sizing: border-box;\n}\n.creditcard-front-uv {\n  background-color: #171717;\n}\n.creditcard-back-uv {\n  background-color: #171717;\n  transform: rotateY(180deg);\n  padding: 0;\n  justify-content: center;\n}\n.creditcard-heading-uv {\n  font-size: 0.6em;\n  letter-spacing: .2em;\n  text-align: right;\n  font-weight: 700;\n  color: #fff;\n}\n.creditcard-chip-uv {\n  margin-top: 8px;\n  width: 36px;\n}\n.creditcard-number-uv {\n  font-weight: bold;\n  font-size: 0.7em;\n  margin-top: 12px;\n  letter-spacing: 2px;\n  text-align: left;\n}\n.creditcard-validlbl-uv {\n  font-size: 0.35em;\n  color: #888;\n  letter-spacing: 1px;\n}\n.creditcard-date-uv {\n  font-weight: bold;\n  font-size: 0.55em;\n}\n.creditcard-name-uv {\n  font-weight: bold;\n  font-size: 0.5em;\n  letter-spacing: 1px;\n}\n.creditcard-strip-uv {\n  width: 100%;\n  height: 1.5em;\n  margin-top: 16px;\n  background: repeating-linear-gradient(45deg, #303030, #303030 10px, #202020 10px, #202020 20px);\n}\n.creditcard-mstrip-uv {\n  background-color: #fff;\n  width: 70%;\n  height: 0.8em;\n  margin: 16px auto 0;\n  border-radius: 2.5px;\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  padding-right: 8px;\n}\n.creditcard-code-uv {\n  font-weight: bold;\n  font-size: 0.5em;\n  color: #000;\n}`,
  },
  {
    id: "card-3d-glass",
    name: "3D Glass",
    author: "Smit-Prajapati",
    html: `<div class="g3d-parent-uv">\n  <div class="g3d-card-uv">\n    <div class="g3d-glass-uv"></div>\n    <div class="g3d-content-uv">\n      <span class="g3d-title-uv">Your Title</span>\n      <span class="g3d-text-uv">Small text here to describe something useful.</span>\n    </div>\n    <div class="g3d-bottom-uv">\n      <div class="g3d-socials-uv">\n        <button class="g3d-social-uv"><svg viewBox="0 0 30 30" width="15" fill="#00894d"><path d="M26.37,26l-8.795-12.822l0.015,0.012L25.52,4h-2.65l-6.46,7.48L11.28,4H4.33l8.211,11.971L12.54,15.97L3.88,26h2.65 l7.182-8.322L19.42,26H26.37z M10.68,6l12.21,18h-2.44L8.15,6H10.68z"/></svg></button>\n        <button class="g3d-social-uv"><svg viewBox="0 0 24 24" width="15" fill="#00894d"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg></button>\n      </div>\n      <div class="g3d-viewmore-uv">\n        <button class="g3d-vm-btn-uv">View More</button>\n        <svg class="g3d-vm-svg-uv" viewBox="0 0 28 12" width="20"><path d="M1 6h24M19 1l6 5-6 5" stroke="#00c37b" stroke-width="3" fill="none"/></svg>\n      </div>\n    </div>\n    <div class="g3d-logo-uv">\n      <div class="g3d-circle-uv g3d-c1-uv"></div>\n      <div class="g3d-circle-uv g3d-c2-uv"></div>\n      <div class="g3d-circle-uv g3d-c3-uv"></div>\n      <div class="g3d-circle-uv g3d-c4-uv"></div>\n      <div class="g3d-circle-uv g3d-c5-uv"><svg viewBox="0 0 24 24" width="20" fill="white"><path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z"/></svg></div>\n    </div>\n  </div>\n</div>`,
    css: `.g3d-parent-uv {\n  width: 290px;\n  height: 300px;\n  perspective: 1000px;\n}\n.g3d-card-uv {\n  height: 100%;\n  border-radius: 50px;\n  background: linear-gradient(135deg, rgb(0, 255, 214) 0%, rgb(8, 226, 96) 100%);\n  transition: all 0.5s ease-in-out;\n  transform-style: preserve-3d;\n  box-shadow: rgba(5, 71, 17, 0) 40px 50px 25px -40px, rgba(5, 71, 17, 0.2) 0px 25px 25px -5px;\n  position: relative;\n}\n.g3d-glass-uv {\n  transform-style: preserve-3d;\n  position: absolute;\n  inset: 8px;\n  border-radius: 55px;\n  border-top-right-radius: 100%;\n  background: linear-gradient(0deg, rgba(255,255,255,0.349) 0%, rgba(255,255,255,0.815) 100%);\n  transform: translate3d(0px, 0px, 25px);\n  border-left: 1px solid white;\n  border-bottom: 1px solid white;\n  transition: all 0.5s ease-in-out;\n}\n.g3d-content-uv {\n  padding: 100px 60px 0px 30px;\n  transform: translate3d(0, 0, 26px);\n  font-family: system-ui, sans-serif;\n}\n.g3d-title-uv {\n  display: block;\n  color: #00894d;\n  font-weight: 900;\n  font-size: 20px;\n}\n.g3d-text-uv {\n  display: block;\n  color: rgba(0, 137, 78, 0.76);\n  font-size: 15px;\n  margin-top: 20px;\n}\n.g3d-bottom-uv {\n  padding: 10px 12px;\n  transform-style: preserve-3d;\n  position: absolute;\n  bottom: 20px;\n  left: 20px;\n  right: 20px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  transform: translate3d(0, 0, 26px);\n}\n.g3d-viewmore-uv {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  transition: all 0.2s ease-in-out;\n}\n.g3d-viewmore-uv:hover { transform: translate3d(0, 0, 10px); }\n.g3d-vm-btn-uv {\n  background: none;\n  border: none;\n  color: #00c37b;\n  font-weight: bolder;\n  font-size: 12px;\n  cursor: pointer;\n  font-family: system-ui, sans-serif;\n}\n.g3d-socials-uv {\n  display: flex;\n  gap: 10px;\n  transform-style: preserve-3d;\n}\n.g3d-social-uv {\n  width: 30px;\n  height: 30px;\n  padding: 5px;\n  background: rgb(255, 255, 255);\n  border-radius: 50%;\n  border: none;\n  display: grid;\n  place-content: center;\n  box-shadow: rgba(5, 71, 17, 0.5) 0px 7px 5px -5px;\n  cursor: pointer;\n  transition: transform 0.2s ease-in-out 0.4s, box-shadow 0.2s ease-in-out 0.4s;\n}\n.g3d-social-uv:nth-child(2) { transition-delay: 0.6s; }\n.g3d-social-uv:hover { background: black; }\n.g3d-social-uv:hover svg { fill: white; }\n.g3d-logo-uv {\n  position: absolute;\n  right: 0;\n  top: 0;\n  transform-style: preserve-3d;\n}\n.g3d-circle-uv {\n  display: block;\n  position: absolute;\n  aspect-ratio: 1;\n  border-radius: 50%;\n  top: 0;\n  right: 0;\n  box-shadow: rgba(100, 100, 111, 0.2) -10px 10px 20px 0px;\n  backdrop-filter: blur(5px);\n  background: rgba(0, 249, 203, 0.2);\n  transition: all 0.5s ease-in-out;\n}\n.g3d-c1-uv { width: 170px; transform: translate3d(0, 0, 20px); top: 8px; right: 8px; }\n.g3d-c2-uv { width: 140px; transform: translate3d(0, 0, 40px); top: 10px; right: 10px; backdrop-filter: blur(1px); transition-delay: 0.4s; }\n.g3d-c3-uv { width: 110px; transform: translate3d(0, 0, 60px); top: 17px; right: 17px; transition-delay: 0.8s; }\n.g3d-c4-uv { width: 80px; transform: translate3d(0, 0, 80px); top: 23px; right: 23px; transition-delay: 1.2s; }\n.g3d-c5-uv { width: 50px; transform: translate3d(0, 0, 100px); top: 30px; right: 30px; display: grid; place-content: center; transition-delay: 1.6s; }\n.g3d-parent-uv:hover .g3d-card-uv {\n  transform: rotate3d(1, 1, 0, 30deg);\n  box-shadow: rgba(5, 71, 17, 0.3) 30px 50px 25px -40px, rgba(5, 71, 17, 0.1) 0px 25px 30px 0px;\n}\n.g3d-parent-uv:hover .g3d-social-uv {\n  transform: translate3d(0, 0, 50px);\n  box-shadow: rgba(5, 71, 17, 0.2) -5px 20px 10px 0px;\n}\n.g3d-parent-uv:hover .g3d-c2-uv { transform: translate3d(0, 0, 60px); }\n.g3d-parent-uv:hover .g3d-c3-uv { transform: translate3d(0, 0, 80px); }\n.g3d-parent-uv:hover .g3d-c4-uv { transform: translate3d(0, 0, 100px); }\n.g3d-parent-uv:hover .g3d-c5-uv { transform: translate3d(0, 0, 120px); }`,
  },
  {
    id: "card-luxury-brand",
    name: "Luxury Brand",
    author: "Smit-Prajapati",
    html: `<div class="lux-card-uv">\n  <div class="lux-content-uv">\n    <div class="lux-logo-uv">\n      <svg class="lux-logo1-uv" viewBox="0 0 24 24" width="33" height="33"><path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" fill="#bd9f67" stroke="#bd9f67" stroke-width="1"/></svg>\n    </div>\n    <p class="lux-logo-text-uv">PREMIUM</p>\n  </div>\n  <div class="lux-border-uv"></div>\n  <p class="lux-bottom-text-uv">ESTABLISHED</p>\n</div>`,
    css: `.lux-card-uv {\n  width: 300px;\n  height: 200px;\n  background: #243137;\n  position: relative;\n  display: grid;\n  place-content: center;\n  border-radius: 10px;\n  overflow: hidden;\n  transition: all 0.5s ease-in-out;\n  font-family: system-ui, sans-serif;\n}\n.lux-border-uv {\n  position: absolute;\n  inset: 0px;\n  border: 2px solid #bd9f67;\n  opacity: 0;\n  transform: rotate(10deg);\n  transition: all 0.5s ease-in-out;\n}\n.lux-bottom-text-uv {\n  position: absolute;\n  left: 50%;\n  bottom: 13px;\n  transform: translateX(-50%);\n  font-size: 6px;\n  text-transform: uppercase;\n  padding: 0px 5px 0px 8px;\n  color: #bd9f67;\n  background: #243137;\n  opacity: 0;\n  letter-spacing: 7px;\n  transition: all 0.5s ease-in-out;\n}\n.lux-content-uv {\n  transition: all 0.5s ease-in-out;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n}\n.lux-logo-uv {\n  height: 35px;\n  position: relative;\n  width: 33px;\n  overflow: hidden;\n  transition: all 1s ease-in-out;\n}\n.lux-logo-text-uv {\n  color: #bd9f67;\n  font-size: 11px;\n  opacity: 0;\n  letter-spacing: 0;\n  margin-top: 10px;\n  transition: all 0.5s ease-in-out 0.5s;\n}\n.lux-card-uv:hover {\n  border-radius: 0;\n  transform: scale(1.1);\n}\n.lux-card-uv:hover .lux-border-uv {\n  inset: 15px;\n  opacity: 1;\n  transform: rotate(0);\n}\n.lux-card-uv:hover .lux-bottom-text-uv {\n  letter-spacing: 3px;\n  opacity: 1;\n}\n.lux-card-uv:hover .lux-logo-text-uv {\n  opacity: 1;\n  letter-spacing: 9.5px;\n}`,
  },
  {
    id: "card-3d-tilt",
    name: "3D Tilt",
    author: "kennyotsu",
    html: `<div class="tilt-container-uv">\n  <div class="tilt-canvas-uv">\n    <div class="tilt-tr-uv tilt-tr1-uv"></div><div class="tilt-tr-uv tilt-tr2-uv"></div><div class="tilt-tr-uv tilt-tr3-uv"></div><div class="tilt-tr-uv tilt-tr4-uv"></div><div class="tilt-tr-uv tilt-tr5-uv"></div>\n    <div class="tilt-tr-uv tilt-tr6-uv"></div><div class="tilt-tr-uv tilt-tr7-uv"></div><div class="tilt-tr-uv tilt-tr8-uv"></div><div class="tilt-tr-uv tilt-tr9-uv"></div><div class="tilt-tr-uv tilt-tr10-uv"></div>\n    <div class="tilt-tr-uv tilt-tr11-uv"></div><div class="tilt-tr-uv tilt-tr12-uv"></div><div class="tilt-tr-uv tilt-tr13-uv"></div><div class="tilt-tr-uv tilt-tr14-uv"></div><div class="tilt-tr-uv tilt-tr15-uv"></div>\n    <div class="tilt-tr-uv tilt-tr16-uv"></div><div class="tilt-tr-uv tilt-tr17-uv"></div><div class="tilt-tr-uv tilt-tr18-uv"></div><div class="tilt-tr-uv tilt-tr19-uv"></div><div class="tilt-tr-uv tilt-tr20-uv"></div>\n    <div class="tilt-tr-uv tilt-tr21-uv"></div><div class="tilt-tr-uv tilt-tr22-uv"></div><div class="tilt-tr-uv tilt-tr23-uv"></div><div class="tilt-tr-uv tilt-tr24-uv"></div><div class="tilt-tr-uv tilt-tr25-uv"></div>\n  </div>\n  <div class="tilt-card-uv">\n    <p class="tilt-prompt-uv">Move your mouse over me</p>\n    <p class="tilt-title-uv">3D Tilt Card</p>\n  </div>\n</div>`,
    css: `.tilt-container-uv {\n  position: relative;\n  width: 190px;\n  height: 254px;\n  transition: 200ms;\n}\n.tilt-card-uv {\n  position: absolute;\n  inset: 0;\n  z-index: 0;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  border-radius: 20px;\n  transition: 700ms;\n  background: linear-gradient(43deg, rgb(65, 88, 208) 0%, rgb(200, 80, 192) 46%, rgb(255, 204, 112) 100%);\n  font-family: system-ui, sans-serif;\n}\n.tilt-card-uv::before {\n  content: '';\n  background: linear-gradient(43deg, rgb(65, 88, 208) 0%, rgb(200, 80, 192) 46%, rgb(255, 204, 112) 100%);\n  filter: blur(2rem);\n  opacity: 30%;\n  width: 100%;\n  height: 100%;\n  position: absolute;\n  z-index: -1;\n  transition: 200ms;\n}\n.tilt-prompt-uv {\n  font-size: 14px;\n  font-weight: bold;\n  color: white;\n  position: absolute;\n  bottom: 8px;\n  left: 12px;\n  max-width: 110px;\n  transition: 300ms;\n}\n.tilt-title-uv {\n  opacity: 0;\n  font-size: x-large;\n  font-weight: bold;\n  color: white;\n  transition: 300ms;\n}\n.tilt-canvas-uv {\n  perspective: 800px;\n  inset: 0;\n  z-index: 200;\n  position: absolute;\n  display: grid;\n  grid-template-columns: repeat(5, 1fr);\n  grid-template-rows: repeat(5, 1fr);\n}\n.tilt-tr-uv { cursor: pointer; }\n.tilt-tr-uv:hover ~ .tilt-card-uv .tilt-title-uv { opacity: 1; }\n.tilt-tr-uv:hover ~ .tilt-card-uv .tilt-prompt-uv { opacity: 0; }\n.tilt-tr-uv:hover ~ .tilt-card-uv { transition: 300ms; filter: brightness(1.1); }\n.tilt-tr1-uv:hover ~ .tilt-card-uv { transform: rotateX(20deg) rotateY(-10deg); }\n.tilt-tr2-uv:hover ~ .tilt-card-uv { transform: rotateX(20deg) rotateY(-5deg); }\n.tilt-tr3-uv:hover ~ .tilt-card-uv { transform: rotateX(20deg) rotateY(0deg); }\n.tilt-tr4-uv:hover ~ .tilt-card-uv { transform: rotateX(20deg) rotateY(5deg); }\n.tilt-tr5-uv:hover ~ .tilt-card-uv { transform: rotateX(20deg) rotateY(10deg); }\n.tilt-tr6-uv:hover ~ .tilt-card-uv { transform: rotateX(10deg) rotateY(-10deg); }\n.tilt-tr7-uv:hover ~ .tilt-card-uv { transform: rotateX(10deg) rotateY(-5deg); }\n.tilt-tr8-uv:hover ~ .tilt-card-uv { transform: rotateX(10deg) rotateY(0deg); }\n.tilt-tr9-uv:hover ~ .tilt-card-uv { transform: rotateX(10deg) rotateY(5deg); }\n.tilt-tr10-uv:hover ~ .tilt-card-uv { transform: rotateX(10deg) rotateY(10deg); }\n.tilt-tr11-uv:hover ~ .tilt-card-uv { transform: rotateX(0deg) rotateY(-10deg); }\n.tilt-tr12-uv:hover ~ .tilt-card-uv { transform: rotateX(0deg) rotateY(-5deg); }\n.tilt-tr13-uv:hover ~ .tilt-card-uv { transform: rotateX(0deg) rotateY(0deg); }\n.tilt-tr14-uv:hover ~ .tilt-card-uv { transform: rotateX(0deg) rotateY(5deg); }\n.tilt-tr15-uv:hover ~ .tilt-card-uv { transform: rotateX(0deg) rotateY(10deg); }\n.tilt-tr16-uv:hover ~ .tilt-card-uv { transform: rotateX(-10deg) rotateY(-10deg); }\n.tilt-tr17-uv:hover ~ .tilt-card-uv { transform: rotateX(-10deg) rotateY(-5deg); }\n.tilt-tr18-uv:hover ~ .tilt-card-uv { transform: rotateX(-10deg) rotateY(0deg); }\n.tilt-tr19-uv:hover ~ .tilt-card-uv { transform: rotateX(-10deg) rotateY(5deg); }\n.tilt-tr20-uv:hover ~ .tilt-card-uv { transform: rotateX(-10deg) rotateY(10deg); }\n.tilt-tr21-uv:hover ~ .tilt-card-uv { transform: rotateX(-20deg) rotateY(-10deg); }\n.tilt-tr22-uv:hover ~ .tilt-card-uv { transform: rotateX(-20deg) rotateY(-5deg); }\n.tilt-tr23-uv:hover ~ .tilt-card-uv { transform: rotateX(-20deg) rotateY(0deg); }\n.tilt-tr24-uv:hover ~ .tilt-card-uv { transform: rotateX(-20deg) rotateY(5deg); }\n.tilt-tr25-uv:hover ~ .tilt-card-uv { transform: rotateX(-20deg) rotateY(10deg); }`,
  },
];

const TOGGLE_TEMPLATES: UITemplate[] = [
  {
    id: "toggle-ios",
    name: "iOS Toggle",
    author: "adamgiebl",
    html: `<label class="ios-toggle-uv"><input type="checkbox" checked><span class="ios-slider-uv"></span></label>`,
    css: `.ios-toggle-uv { position: relative; display: inline-block; width: 52px; height: 30px; }\n.ios-toggle-uv input { opacity: 0; width: 0; height: 0; }\n.ios-slider-uv { position: absolute; cursor: pointer; inset: 0; background: #555; border-radius: 30px; transition: 0.3s; }\n.ios-slider-uv::before { content: ""; position: absolute; width: 24px; height: 24px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.3s; }\n.ios-toggle-uv input:checked + .ios-slider-uv { background: #4ade80; }\n.ios-toggle-uv input:checked + .ios-slider-uv::before { transform: translateX(22px); }`,
  },
  {
    id: "toggle-dark-mode",
    name: "Day/Night",
    author: "mrhyddenn",
    html: `<label class="daynight-uv"><input type="checkbox"><span class="dn-slider-uv">🌙<span class="dn-sun-uv">☀️</span></span></label>`,
    css: `.daynight-uv { position: relative; display: inline-block; width: 60px; height: 30px; }\n.daynight-uv input { opacity: 0; width: 0; height: 0; }\n.dn-slider-uv { position: absolute; cursor: pointer; inset: 0; background: #1a1a2e; border-radius: 30px; transition: 0.4s; font-size: 0.7rem; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; }\n.dn-sun-uv { position: absolute; left: 8px; opacity: 0; transition: opacity 0.3s; }\n.dn-slider-uv::before { content: ""; position: absolute; width: 24px; height: 24px; left: 3px; bottom: 3px; background: #f1c40f; border-radius: 50%; transition: 0.4s; z-index: 1; }\n.daynight-uv input:checked + .dn-slider-uv { background: #87ceeb; }\n.daynight-uv input:checked + .dn-slider-uv::before { transform: translateX(30px); background: #f39c12; }\n.daynight-uv input:checked + .dn-slider-uv .dn-sun-uv { opacity: 1; }`,
  },
  {
    id: "toggle-neon",
    name: "Neon Toggle",
    author: "zanina-yassine",
    html: `<label class="neon-toggle-uv"><input type="checkbox"><span class="neon-track-uv"></span></label>`,
    css: `.neon-toggle-uv { position: relative; display: inline-block; width: 52px; height: 28px; }\n.neon-toggle-uv input { opacity: 0; width: 0; height: 0; }\n.neon-track-uv { position: absolute; cursor: pointer; inset: 0; background: #111; border: 2px solid #333; border-radius: 28px; transition: 0.3s; }\n.neon-track-uv::before { content: ""; position: absolute; width: 20px; height: 20px; left: 2px; bottom: 2px; background: #666; border-radius: 50%; transition: 0.3s; }\n.neon-toggle-uv input:checked + .neon-track-uv { border-color: #0ff; box-shadow: 0 0 10px #0ff4, inset 0 0 10px #0ff2; }\n.neon-toggle-uv input:checked + .neon-track-uv::before { transform: translateX(24px); background: #0ff; box-shadow: 0 0 8px #0ff; }`,
  },
  {
    id: "toggle-material",
    name: "Material",
    author: "vinodjangid07",
    html: `<label class="material-toggle-uv"><input type="checkbox"><span class="mat-track-uv"><span class="mat-thumb-uv"></span></span></label>`,
    css: `.material-toggle-uv { display: inline-flex; align-items: center; cursor: pointer; }\n.material-toggle-uv input { opacity: 0; width: 0; height: 0; position: absolute; }\n.mat-track-uv { position: relative; width: 36px; height: 14px; background: #555; border-radius: 14px; transition: background 0.3s; }\n.mat-thumb-uv { position: absolute; top: -3px; left: 0; width: 20px; height: 20px; background: #ccc; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: 0.3s; }\n.material-toggle-uv input:checked + .mat-track-uv { background: #667eea60; }\n.material-toggle-uv input:checked + .mat-track-uv .mat-thumb-uv { transform: translateX(16px); background: #667eea; }`,
  },
  {
    id: "toggle-pill",
    name: "Pill Toggle",
    author: "gharsh11032000",
    html: `<label class="pill-toggle-uv"><input type="checkbox"><span class="pill-track-uv"><span class="pill-on-uv">ON</span><span class="pill-off-uv">OFF</span></span></label>`,
    css: `.pill-toggle-uv { position: relative; display: inline-block; width: 70px; height: 32px; }\n.pill-toggle-uv input { opacity: 0; width: 0; height: 0; }\n.pill-track-uv { position: absolute; cursor: pointer; inset: 0; background: #333; border-radius: 32px; transition: 0.3s; overflow: hidden; }\n.pill-on-uv, .pill-off-uv { position: absolute; top: 50%; transform: translateY(-50%); font-size: 0.6rem; font-weight: 700; font-family: system-ui, sans-serif; transition: 0.3s; }\n.pill-on-uv { left: 12px; color: #fff; opacity: 0; }\n.pill-off-uv { right: 12px; color: #888; }\n.pill-track-uv::before { content: ""; position: absolute; width: 26px; height: 26px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.3s; z-index: 1; }\n.pill-toggle-uv input:checked + .pill-track-uv { background: #667eea; }\n.pill-toggle-uv input:checked + .pill-track-uv::before { transform: translateX(38px); }\n.pill-toggle-uv input:checked + .pill-track-uv .pill-on-uv { opacity: 1; }\n.pill-toggle-uv input:checked + .pill-track-uv .pill-off-uv { opacity: 0; }`,
  },
  {
    id: "toggle-flat",
    name: "Flat Switch",
    author: "Nawsome",
    html: `<label class="flat-toggle-uv"><input type="checkbox"><span class="flat-sw-uv"></span></label>`,
    css: `.flat-toggle-uv { position: relative; display: inline-block; width: 48px; height: 24px; }\n.flat-toggle-uv input { opacity: 0; width: 0; height: 0; }\n.flat-sw-uv { position: absolute; cursor: pointer; inset: 0; background: #3a3a3a; border-radius: 4px; transition: 0.3s; }\n.flat-sw-uv::before { content: ""; position: absolute; width: 20px; height: 20px; left: 2px; top: 2px; background: #888; border-radius: 3px; transition: 0.3s; }\n.flat-toggle-uv input:checked + .flat-sw-uv { background: #667eea30; }\n.flat-toggle-uv input:checked + .flat-sw-uv::before { transform: translateX(24px); background: #667eea; }`,
  },
  {
    id: "toggle-liquid",
    name: "Liquid Toggle",
    author: "cssbuttons-io",
    html: `<label class="liquid-toggle-uv"><input type="checkbox"><span class="liquid-track-uv"></span></label>`,
    css: `.liquid-toggle-uv { position: relative; display: inline-block; width: 56px; height: 30px; }\n.liquid-toggle-uv input { opacity: 0; width: 0; height: 0; }\n.liquid-track-uv { position: absolute; cursor: pointer; inset: 0; background: #2a2a2a; border-radius: 30px; transition: 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55); }\n.liquid-track-uv::before { content: ""; position: absolute; width: 24px; height: 24px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55); }\n.liquid-toggle-uv input:checked + .liquid-track-uv { background: #a855f7; }\n.liquid-toggle-uv input:checked + .liquid-track-uv::before { transform: translateX(26px); }`,
  },
  {
    id: "toggle-checkbox-round",
    name: "Round Checkbox",
    author: "Pradeepsaranbishnoi",
    html: `<label class="rcheck-uv"><input type="checkbox" checked><span class="rcheck-mark-uv">✓</span> Agree to terms</label>`,
    css: `.rcheck-uv { display: flex; align-items: center; gap: 10px; cursor: pointer; color: #fff; font-size: 0.85rem; font-family: system-ui, sans-serif; }\n.rcheck-uv input { display: none; }\n.rcheck-mark-uv { width: 22px; height: 22px; border-radius: 50%; border: 2px solid #555; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; color: transparent; transition: 0.3s; }\n.rcheck-uv input:checked + .rcheck-mark-uv { background: #667eea; border-color: #667eea; color: #fff; }`,
  },
  {
    id: "toggle-slide-text",
    name: "Slide Text",
    author: "SpatexDEV",
    html: `<label class="slide-text-uv"><input type="checkbox"><span class="st-track-uv"><span class="st-label-uv">OFF</span></span></label>`,
    css: `.slide-text-uv { position: relative; display: inline-block; width: 80px; height: 34px; }\n.slide-text-uv input { opacity: 0; width: 0; height: 0; }\n.st-track-uv { position: absolute; cursor: pointer; inset: 0; background: #333; border-radius: 34px; transition: 0.3s; }\n.st-label-uv { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); font-size: 0.65rem; font-weight: 700; color: #888; transition: 0.3s; font-family: system-ui, sans-serif; }\n.st-track-uv::before { content: ""; position: absolute; width: 28px; height: 28px; left: 3px; top: 3px; background: #888; border-radius: 50%; transition: 0.3s; }\n.slide-text-uv input:checked + .st-track-uv { background: #10b981; }\n.slide-text-uv input:checked + .st-track-uv::before { transform: translateX(46px); background: #fff; }\n.slide-text-uv input:checked + .st-track-uv .st-label-uv { left: 14px; right: auto; color: #fff; }`,
  },
  {
    id: "toggle-emoji",
    name: "Emoji Toggle",
    author: "JkHuger",
    html: `<label class="emoji-toggle-uv"><input type="checkbox"><span class="emoji-track-uv"><span class="emoji-face-uv">😴</span></span></label>`,
    css: `.emoji-toggle-uv { position: relative; display: inline-block; width: 60px; height: 30px; }\n.emoji-toggle-uv input { opacity: 0; width: 0; height: 0; }\n.emoji-track-uv { position: absolute; cursor: pointer; inset: 0; background: #333; border-radius: 30px; transition: 0.4s; }\n.emoji-face-uv { position: absolute; top: 1px; left: 2px; font-size: 1.5rem; line-height: 1; transition: 0.4s; }\n.emoji-toggle-uv input:checked + .emoji-track-uv { background: #fbbf2440; }\n.emoji-toggle-uv input:checked + .emoji-track-uv .emoji-face-uv { transform: translateX(28px); }`,
  },
  {
    id: "toggle-gradient",
    name: "Gradient Switch",
    author: "elijahgummer",
    html: `<label class="grad-toggle-uv"><input type="checkbox"><span class="grad-sw-uv"></span></label>`,
    css: `.grad-toggle-uv { position: relative; display: inline-block; width: 54px; height: 28px; }\n.grad-toggle-uv input { opacity: 0; width: 0; height: 0; }\n.grad-sw-uv { position: absolute; cursor: pointer; inset: 0; background: #333; border-radius: 28px; transition: 0.4s; }\n.grad-sw-uv::before { content: ""; position: absolute; width: 22px; height: 22px; left: 3px; top: 3px; background: #888; border-radius: 50%; transition: 0.4s; }\n.grad-toggle-uv input:checked + .grad-sw-uv { background: linear-gradient(135deg, #667eea, #764ba2); }\n.grad-toggle-uv input:checked + .grad-sw-uv::before { transform: translateX(26px); background: #fff; }`,
  },
  {
    id: "toggle-radio-pill",
    name: "Radio Pills",
    author: "portseif",
    html: `<div class="radio-pills-uv">\n  <label><input type="radio" name="rp" checked><span>Small</span></label>\n  <label><input type="radio" name="rp"><span>Medium</span></label>\n  <label><input type="radio" name="rp"><span>Large</span></label>\n</div>`,
    css: `.radio-pills-uv { display: inline-flex; background: #222; border-radius: 8px; padding: 4px; gap: 4px; font-family: system-ui, sans-serif; }\n.radio-pills-uv label { cursor: pointer; }\n.radio-pills-uv input { display: none; }\n.radio-pills-uv span { display: block; padding: 8px 16px; border-radius: 6px; font-size: 0.8rem; color: #888; transition: 0.3s; font-weight: 500; }\n.radio-pills-uv input:checked + span { background: #667eea; color: #fff; }`,
  },
  {
    id: "toggle-power",
    name: "Power Button",
    author: "barisdogansutcu",
    html: `<label class="power-toggle-uv"><input type="checkbox"><span class="power-circle-uv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10"/></svg></span></label>`,
    css: `.power-toggle-uv { display: inline-block; cursor: pointer; }\n.power-toggle-uv input { display: none; }\n.power-circle-uv { display: flex; align-items: center; justify-content: center; width: 50px; height: 50px; border-radius: 50%; background: #222; border: 2px solid #444; transition: 0.3s; }\n.power-circle-uv svg { width: 24px; height: 24px; color: #666; transition: 0.3s; }\n.power-toggle-uv input:checked + .power-circle-uv { border-color: #4ade80; box-shadow: 0 0 15px #4ade8040; }\n.power-toggle-uv input:checked + .power-circle-uv svg { color: #4ade80; }`,
  },
  {
    id: "toggle-minimize",
    name: "Minimal Toggle",
    author: "TaniaDou",
    html: `<label class="min-toggle-uv"><input type="checkbox"><span class="min-line-uv"></span></label>`,
    css: `.min-toggle-uv { position: relative; display: inline-block; width: 40px; height: 20px; }\n.min-toggle-uv input { opacity: 0; width: 0; height: 0; }\n.min-line-uv { position: absolute; cursor: pointer; inset: 0; }\n.min-line-uv::after { content: ""; position: absolute; top: 8px; left: 0; right: 0; height: 4px; background: #555; border-radius: 2px; transition: background 0.3s; }\n.min-line-uv::before { content: ""; position: absolute; width: 16px; height: 16px; left: 0; top: 2px; background: #888; border-radius: 50%; transition: 0.3s; z-index: 1; }\n.min-toggle-uv input:checked + .min-line-uv::after { background: #667eea50; }\n.min-toggle-uv input:checked + .min-line-uv::before { transform: translateX(24px); background: #667eea; }`,
  },
  {
    id: "toggle-expand",
    name: "Expand Toggle",
    author: "Ali-Tahmazi99",
    html: `<label class="expand-toggle-uv"><input type="checkbox"><span class="exp-box-uv"><span class="exp-icon-uv">+</span></span></label>`,
    css: `.expand-toggle-uv { display: inline-block; cursor: pointer; }\n.expand-toggle-uv input { display: none; }\n.exp-box-uv { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: #222; border: 1px solid #444; border-radius: 8px; transition: 0.3s; }\n.exp-icon-uv { color: #888; font-size: 1.2rem; font-weight: 300; transition: 0.3s; font-family: system-ui, sans-serif; }\n.expand-toggle-uv input:checked + .exp-box-uv { background: #667eea; border-color: #667eea; }\n.expand-toggle-uv input:checked + .exp-box-uv .exp-icon-uv { transform: rotate(45deg); color: #fff; }`,
  },
  {
    id: "toggle-heart",
    name: "Heart Like",
    author: "Yaya12085",
    html: `<label class="heart-toggle-uv"><input type="checkbox"><span class="heart-icon-uv">♥</span></label>`,
    css: `.heart-toggle-uv { display: inline-block; cursor: pointer; }\n.heart-toggle-uv input { display: none; }\n.heart-icon-uv { font-size: 1.8rem; color: #555; transition: 0.3s; display: block; }\n.heart-toggle-uv input:checked + .heart-icon-uv { color: #ef4444; transform: scale(1.2); animation: heart-pop-uv 0.3s ease; }\n@keyframes heart-pop-uv { 0% { transform: scale(1); } 50% { transform: scale(1.4); } 100% { transform: scale(1.2); } }`,
  },
  {
    id: "toggle-bookmark",
    name: "Bookmark",
    author: "itsKrish01",
    html: `<label class="bmark-toggle-uv"><input type="checkbox"><span class="bmark-icon-uv"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></span></label>`,
    css: `.bmark-toggle-uv { display: inline-block; cursor: pointer; }\n.bmark-toggle-uv input { display: none; }\n.bmark-icon-uv { display: block; transition: 0.3s; }\n.bmark-icon-uv svg { width: 28px; height: 28px; color: #555; transition: 0.3s; }\n.bmark-toggle-uv input:checked + .bmark-icon-uv svg { color: #fbbf24; transform: scale(1.1); }`,
  },
  {
    id: "toggle-star-rating",
    name: "Star Rating",
    author: "cssbuttons-io",
    html: `<div class="star-rate-uv">\n  <input type="radio" name="star" id="s5"><label for="s5">★</label>\n  <input type="radio" name="star" id="s4"><label for="s4">★</label>\n  <input type="radio" name="star" id="s3" checked><label for="s3">★</label>\n  <input type="radio" name="star" id="s2"><label for="s2">★</label>\n  <input type="radio" name="star" id="s1"><label for="s1">★</label>\n</div>`,
    css: `.star-rate-uv { display: inline-flex; flex-direction: row-reverse; gap: 4px; }\n.star-rate-uv input { display: none; }\n.star-rate-uv label { font-size: 1.5rem; color: #444; cursor: pointer; transition: 0.2s; }\n.star-rate-uv input:checked ~ label { color: #fbbf24; }\n.star-rate-uv label:hover, .star-rate-uv label:hover ~ label { color: #f59e0b; }`,
  },
  {
    id: "toggle-theme-icon",
    name: "Theme Icon",
    author: "alexmaracinaru",
    html: `<label class="theme-icon-uv"><input type="checkbox"><span class="theme-wrap-uv"><span class="theme-light-uv">☀️</span><span class="theme-dark-uv">🌙</span></span></label>`,
    css: `.theme-icon-uv { display: inline-block; cursor: pointer; }\n.theme-icon-uv input { display: none; }\n.theme-wrap-uv { display: flex; width: 40px; height: 40px; background: #222; border-radius: 50%; align-items: center; justify-content: center; transition: 0.3s; position: relative; overflow: hidden; }\n.theme-light-uv, .theme-dark-uv { position: absolute; font-size: 1.2rem; transition: 0.3s; }\n.theme-dark-uv { opacity: 0; transform: translateY(20px); }\n.theme-icon-uv input:checked + .theme-wrap-uv { background: #1a1a2e; }\n.theme-icon-uv input:checked + .theme-wrap-uv .theme-light-uv { opacity: 0; transform: translateY(-20px); }\n.theme-icon-uv input:checked + .theme-wrap-uv .theme-dark-uv { opacity: 1; transform: translateY(0); }`,
  },
  {
    id: "toggle-color-pick",
    name: "Color Picker",
    author: "Smit-Prajapati",
    html: `<div class="color-pick-uv">\n  <label><input type="radio" name="clr" checked><span style="background:#667eea"></span></label>\n  <label><input type="radio" name="clr"><span style="background:#ef4444"></span></label>\n  <label><input type="radio" name="clr"><span style="background:#10b981"></span></label>\n  <label><input type="radio" name="clr"><span style="background:#f59e0b"></span></label>\n</div>`,
    css: `.color-pick-uv { display: flex; gap: 10px; }\n.color-pick-uv label { cursor: pointer; }\n.color-pick-uv input { display: none; }\n.color-pick-uv span { display: block; width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; transition: 0.2s; }\n.color-pick-uv input:checked + span { border-color: #fff; transform: scale(1.15); box-shadow: 0 0 8px rgba(255,255,255,0.3); }`,
  },
  {
    id: "toggle-checkbox-anim",
    name: "Animated Check",
    author: "sahilxkhadka",
    html: `<label class="animcheck-uv"><input type="checkbox" checked><span class="animcheck-box-uv"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span><span class="animcheck-text-uv">Remember me</span></label>`,
    css: `.animcheck-uv { display: flex; align-items: center; gap: 10px; cursor: pointer; color: #fff; font-size: 0.85rem; font-family: system-ui, sans-serif; }\n.animcheck-uv input { display: none; }\n.animcheck-box-uv { width: 22px; height: 22px; border-radius: 6px; border: 2px solid #555; display: flex; align-items: center; justify-content: center; transition: 0.3s; }\n.animcheck-box-uv svg { width: 14px; height: 14px; opacity: 0; transform: scale(0); transition: 0.2s; }\n.animcheck-uv input:checked + .animcheck-box-uv { background: #667eea; border-color: #667eea; }\n.animcheck-uv input:checked + .animcheck-box-uv svg { opacity: 1; transform: scale(1); }`,
  },
  {
    id: "toggle-segment",
    name: "Segment Control",
    author: "martinval11",
    html: `<div class="segment-uv">\n  <label><input type="radio" name="seg" checked><span>Daily</span></label>\n  <label><input type="radio" name="seg"><span>Weekly</span></label>\n  <label><input type="radio" name="seg"><span>Monthly</span></label>\n</div>`,
    css: `.segment-uv { display: inline-flex; background: #1a1a1a; border-radius: 10px; padding: 3px; font-family: system-ui, sans-serif; border: 1px solid #333; }\n.segment-uv label { cursor: pointer; }\n.segment-uv input { display: none; }\n.segment-uv span { display: block; padding: 8px 18px; border-radius: 8px; font-size: 0.8rem; color: #888; transition: 0.3s; }\n.segment-uv input:checked + span { background: #fff; color: #000; font-weight: 600; }`,
  },
  {
    id: "toggle-3d",
    name: "3D Toggle",
    author: "FColombati",
    html: `<label class="t3d-toggle-uv"><input type="checkbox"><span class="t3d-track-uv"></span></label>`,
    css: `.t3d-toggle-uv { position: relative; display: inline-block; width: 54px; height: 28px; }\n.t3d-toggle-uv input { opacity: 0; width: 0; height: 0; }\n.t3d-track-uv { position: absolute; cursor: pointer; inset: 0; background: #2a2a2a; border-radius: 28px; transition: 0.3s; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); }\n.t3d-track-uv::before { content: ""; position: absolute; width: 22px; height: 22px; left: 3px; top: 3px; background: linear-gradient(145deg, #e0e0e0, #aaa); border-radius: 50%; transition: 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }\n.t3d-toggle-uv input:checked + .t3d-track-uv { background: #10b981; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2); }\n.t3d-toggle-uv input:checked + .t3d-track-uv::before { transform: translateX(26px); }`,
  },
  {
    id: "toggle-wifi",
    name: "WiFi Toggle",
    author: "bandirevanth",
    html: `<label class="wifi-toggle-uv"><input type="checkbox" checked><span class="wifi-box-uv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0114 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg></span></label>`,
    css: `.wifi-toggle-uv { display: inline-block; cursor: pointer; }\n.wifi-toggle-uv input { display: none; }\n.wifi-box-uv { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: #222; border-radius: 12px; transition: 0.3s; }\n.wifi-box-uv svg { width: 22px; height: 22px; color: #555; transition: 0.3s; }\n.wifi-toggle-uv input:checked + .wifi-box-uv { background: #667eea20; }\n.wifi-toggle-uv input:checked + .wifi-box-uv svg { color: #667eea; }`,
  },
  {
    id: "toggle-volume",
    name: "Volume",
    author: "Spacious74",
    html: `<label class="vol-toggle-uv"><input type="checkbox"><span class="vol-box-uv"><svg class="vol-on-uv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg><svg class="vol-off-uv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg></span></label>`,
    css: `.vol-toggle-uv { display: inline-block; cursor: pointer; }\n.vol-toggle-uv input { display: none; }\n.vol-box-uv { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: #222; border-radius: 10px; transition: 0.3s; }\n.vol-box-uv svg { width: 20px; height: 20px; color: #888; transition: 0.3s; }\n.vol-on-uv { display: none; }\n.vol-off-uv { display: block; }\n.vol-toggle-uv input:checked + .vol-box-uv .vol-on-uv { display: block; color: #4ade80; }\n.vol-toggle-uv input:checked + .vol-box-uv .vol-off-uv { display: none; }`,
  },
  {
    id: "toggle-tabs",
    name: "Toggle Tabs",
    author: "cssbuttons-io",
    html: `<div class="toggle-tabs-uv">\n  <label><input type="radio" name="ttab" checked><span>Login</span></label>\n  <label><input type="radio" name="ttab"><span>Register</span></label>\n</div>`,
    css: `.toggle-tabs-uv { display: inline-flex; background: #1e1e1e; border-radius: 50px; padding: 4px; font-family: system-ui, sans-serif; }\n.toggle-tabs-uv label { cursor: pointer; }\n.toggle-tabs-uv input { display: none; }\n.toggle-tabs-uv span { display: block; padding: 10px 24px; border-radius: 50px; font-size: 0.8rem; color: #888; transition: 0.3s; font-weight: 500; }\n.toggle-tabs-uv input:checked + span { background: #667eea; color: #fff; }`,
  },
  {
    id: "toggle-border-glow",
    name: "Glow Switch",
    author: "MuhammadHasann",
    html: `<label class="glow-sw-uv"><input type="checkbox"><span class="glow-track-uv"></span></label>`,
    css: `.glow-sw-uv { position: relative; display: inline-block; width: 52px; height: 28px; }\n.glow-sw-uv input { opacity: 0; width: 0; height: 0; }\n.glow-track-uv { position: absolute; cursor: pointer; inset: 0; background: #222; border: 1px solid #444; border-radius: 28px; transition: 0.3s; }\n.glow-track-uv::before { content: ""; position: absolute; width: 22px; height: 22px; left: 2px; top: 2px; background: #666; border-radius: 50%; transition: 0.3s; }\n.glow-sw-uv input:checked + .glow-track-uv { background: #10b98120; border-color: #10b981; box-shadow: 0 0 12px #10b98140; }\n.glow-sw-uv input:checked + .glow-track-uv::before { transform: translateX(24px); background: #10b981; box-shadow: 0 0 6px #10b98180; }`,
  },
  {
    id: "toggle-size-picker",
    name: "Size Picker",
    author: "Ashon-G",
    html: `<div class="size-pick-uv">\n  <label><input type="radio" name="sz" checked><span>S</span></label>\n  <label><input type="radio" name="sz"><span>M</span></label>\n  <label><input type="radio" name="sz"><span>L</span></label>\n  <label><input type="radio" name="sz"><span>XL</span></label>\n</div>`,
    css: `.size-pick-uv { display: flex; gap: 8px; }\n.size-pick-uv label { cursor: pointer; }\n.size-pick-uv input { display: none; }\n.size-pick-uv span { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: #222; border: 1px solid #444; border-radius: 8px; font-size: 0.75rem; font-weight: 600; color: #888; transition: 0.2s; font-family: system-ui, sans-serif; }\n.size-pick-uv input:checked + span { background: #fff; color: #000; border-color: #fff; }`,
  },
  {
    id: "toggle-chip-group",
    name: "Chip Group",
    author: "Smit-Prajapati",
    html: `<div class="chip-group-uv">\n  <label><input type="checkbox" checked><span>React</span></label>\n  <label><input type="checkbox"><span>Vue</span></label>\n  <label><input type="checkbox" checked><span>Svelte</span></label>\n  <label><input type="checkbox"><span>Angular</span></label>\n</div>`,
    css: `.chip-group-uv { display: flex; flex-wrap: wrap; gap: 8px; }\n.chip-group-uv label { cursor: pointer; }\n.chip-group-uv input { display: none; }\n.chip-group-uv span { display: block; padding: 6px 16px; background: #222; border: 1px solid #444; border-radius: 20px; font-size: 0.8rem; color: #888; transition: 0.2s; font-family: system-ui, sans-serif; }\n.chip-group-uv input:checked + span { background: #667eea20; border-color: #667eea; color: #667eea; }`,
  },
];

const LOADER_TEMPLATES: UITemplate[] = [
  {
    id: "loader-spinner",
    name: "Spinner",
    author: "adamgiebl",
    html: `<div class="spinner-uv"></div>`,
    css: `.spinner-uv { width: 40px; height: 40px; border: 4px solid #333; border-top-color: #667eea; border-radius: 50%; animation: spin-uv 0.8s linear infinite; }\n@keyframes spin-uv { to { transform: rotate(360deg); } }`,
  },
  {
    id: "loader-dots-bounce",
    name: "Bouncing Dots",
    author: "vinodjangid07",
    html: `<div class="bounce-dots-uv"><span></span><span></span><span></span></div>`,
    css: `.bounce-dots-uv { display: flex; gap: 6px; }\n.bounce-dots-uv span { width: 10px; height: 10px; background: #667eea; border-radius: 50%; animation: bounce-uv 0.6s infinite alternate; }\n.bounce-dots-uv span:nth-child(2) { animation-delay: 0.2s; }\n.bounce-dots-uv span:nth-child(3) { animation-delay: 0.4s; }\n@keyframes bounce-uv { to { transform: translateY(-12px); opacity: 0.3; } }`,
  },
  {
    id: "loader-pulse",
    name: "Pulse",
    author: "zanina-yassine",
    html: `<div class="pulse-loader-uv"></div>`,
    css: `.pulse-loader-uv { width: 40px; height: 40px; background: #667eea; border-radius: 50%; animation: pulse-uv 1.2s ease-in-out infinite; }\n@keyframes pulse-uv { 0% { transform: scale(0); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }`,
  },
  {
    id: "loader-bars",
    name: "Bars",
    author: "mrhyddenn",
    html: `<div class="bars-loader-uv"><span></span><span></span><span></span><span></span><span></span></div>`,
    css: `.bars-loader-uv { display: flex; gap: 4px; align-items: center; height: 30px; }\n.bars-loader-uv span { width: 4px; height: 100%; background: #667eea; border-radius: 2px; animation: bar-uv 1s ease-in-out infinite; }\n.bars-loader-uv span:nth-child(1) { animation-delay: 0s; }\n.bars-loader-uv span:nth-child(2) { animation-delay: 0.1s; }\n.bars-loader-uv span:nth-child(3) { animation-delay: 0.2s; }\n.bars-loader-uv span:nth-child(4) { animation-delay: 0.3s; }\n.bars-loader-uv span:nth-child(5) { animation-delay: 0.4s; }\n@keyframes bar-uv { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }`,
  },
  {
    id: "loader-ring",
    name: "Ring",
    author: "gharsh11032000",
    html: `<div class="ring-loader-uv"><div></div></div>`,
    css: `.ring-loader-uv { width: 44px; height: 44px; position: relative; }\n.ring-loader-uv div { width: 100%; height: 100%; border: 3px solid transparent; border-top-color: #667eea; border-right-color: #667eea; border-radius: 50%; animation: spin-uv 1s linear infinite; }\n@keyframes spin-uv { to { transform: rotate(360deg); } }`,
  },
  {
    id: "loader-wave",
    name: "Wave",
    author: "Nawsome",
    html: `<div class="wave-loader-uv"><span></span><span></span><span></span><span></span><span></span></div>`,
    css: `.wave-loader-uv { display: flex; gap: 3px; align-items: flex-end; height: 24px; }\n.wave-loader-uv span { width: 5px; background: #a855f7; border-radius: 3px; animation: wave-uv 1.2s ease-in-out infinite; }\n.wave-loader-uv span:nth-child(1) { height: 10px; animation-delay: 0s; }\n.wave-loader-uv span:nth-child(2) { height: 16px; animation-delay: 0.15s; }\n.wave-loader-uv span:nth-child(3) { height: 24px; animation-delay: 0.3s; }\n.wave-loader-uv span:nth-child(4) { height: 16px; animation-delay: 0.45s; }\n.wave-loader-uv span:nth-child(5) { height: 10px; animation-delay: 0.6s; }\n@keyframes wave-uv { 0%, 100% { transform: scaleY(0.5); } 50% { transform: scaleY(1); } }`,
  },
  {
    id: "loader-dual-ring",
    name: "Dual Ring",
    author: "cssbuttons-io",
    html: `<div class="dual-ring-uv"></div>`,
    css: `.dual-ring-uv { width: 44px; height: 44px; border: 4px solid transparent; border-top-color: #667eea; border-bottom-color: #a855f7; border-radius: 50%; animation: spin-uv 1s linear infinite; }\n@keyframes spin-uv { to { transform: rotate(360deg); } }`,
  },
  {
    id: "loader-typing",
    name: "Typing",
    author: "Pradeepsaranbishnoi",
    html: `<div class="typing-uv"><span></span><span></span><span></span></div>`,
    css: `.typing-uv { display: flex; gap: 5px; padding: 10px 16px; background: #2a2a2a; border-radius: 20px; }\n.typing-uv span { width: 8px; height: 8px; background: #888; border-radius: 50%; animation: typing-anim-uv 1.4s ease-in-out infinite; }\n.typing-uv span:nth-child(2) { animation-delay: 0.2s; }\n.typing-uv span:nth-child(3) { animation-delay: 0.4s; }\n@keyframes typing-anim-uv { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-8px); } }`,
  },
  {
    id: "loader-orbit",
    name: "Orbit",
    author: "JkHuger",
    html: `<div class="orbit-uv"><div class="orbit-dot-uv"></div></div>`,
    css: `.orbit-uv { width: 44px; height: 44px; border: 2px solid #333; border-radius: 50%; position: relative; animation: spin-uv 1.5s linear infinite; }\n.orbit-dot-uv { position: absolute; top: -5px; left: 50%; transform: translateX(-50%); width: 10px; height: 10px; background: #667eea; border-radius: 50%; }\n@keyframes spin-uv { to { transform: rotate(360deg); } }`,
  },
  {
    id: "loader-skeleton",
    name: "Skeleton",
    author: "portseif",
    html: `<div class="skeleton-uv">\n  <div class="skel-circle-uv"></div>\n  <div class="skel-lines-uv"><div></div><div></div><div></div></div>\n</div>`,
    css: `.skeleton-uv { display: flex; gap: 14px; padding: 16px; background: #1e1e1e; border-radius: 12px; width: 240px; }\n.skel-circle-uv { width: 44px; height: 44px; border-radius: 50%; background: #333; animation: skel-uv 1.5s infinite; flex-shrink: 0; }\n.skel-lines-uv { flex: 1; display: flex; flex-direction: column; gap: 8px; }\n.skel-lines-uv div { height: 10px; background: #333; border-radius: 4px; animation: skel-uv 1.5s infinite; }\n.skel-lines-uv div:nth-child(2) { width: 80%; }\n.skel-lines-uv div:nth-child(3) { width: 60%; }\n@keyframes skel-uv { 0% { opacity: 0.3; } 50% { opacity: 1; } 100% { opacity: 0.3; } }`,
  },
  {
    id: "loader-progress",
    name: "Progress Bar",
    author: "elijahgummer",
    html: `<div class="progress-uv"><div class="progress-bar-uv"></div></div>`,
    css: `.progress-uv { width: 200px; height: 6px; background: #333; border-radius: 3px; overflow: hidden; }\n.progress-bar-uv { width: 30%; height: 100%; background: linear-gradient(90deg, #667eea, #a855f7); border-radius: 3px; animation: progress-anim-uv 2s ease-in-out infinite; }\n@keyframes progress-anim-uv { 0% { width: 0%; } 50% { width: 80%; } 100% { width: 0%; } }`,
  },
  {
    id: "loader-circle-fill",
    name: "Circle Fill",
    author: "TaniaDou",
    html: `<div class="cfill-uv"></div>`,
    css: `.cfill-uv { width: 40px; height: 40px; border-radius: 50%; background: conic-gradient(#667eea 0%, transparent 0%); animation: cfill-anim-uv 2s linear infinite; position: relative; }\n.cfill-uv::before { content: ""; position: absolute; inset: 6px; background: #212121; border-radius: 50%; }\n@keyframes cfill-anim-uv { 0% { background: conic-gradient(#667eea 0%, transparent 0%); } 50% { background: conic-gradient(#667eea 50%, transparent 50%); } 100% { background: conic-gradient(#667eea 100%, transparent 100%); } }`,
  },
  {
    id: "loader-squares",
    name: "Folding Squares",
    author: "Ali-Tahmazi99",
    html: `<div class="fold-sq-uv"><span></span><span></span><span></span><span></span></div>`,
    css: `.fold-sq-uv { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; width: 36px; height: 36px; }\n.fold-sq-uv span { background: #667eea; border-radius: 2px; animation: fold-uv 1.2s ease infinite; }\n.fold-sq-uv span:nth-child(2) { animation-delay: 0.15s; }\n.fold-sq-uv span:nth-child(3) { animation-delay: 0.45s; }\n.fold-sq-uv span:nth-child(4) { animation-delay: 0.3s; }\n@keyframes fold-uv { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.5); opacity: 0.3; } }`,
  },
  {
    id: "loader-hourglass",
    name: "Hourglass",
    author: "SpatexDEV",
    html: `<div class="hourglass-uv">⏳</div>`,
    css: `.hourglass-uv { font-size: 2rem; animation: hg-uv 1.5s ease-in-out infinite; }\n@keyframes hg-uv { 0% { transform: rotate(0); } 50% { transform: rotate(180deg); } 100% { transform: rotate(360deg); } }`,
  },
  {
    id: "loader-gradient-spin",
    name: "Gradient Spin",
    author: "Smit-Prajapati",
    html: `<div class="gradspin-uv"></div>`,
    css: `.gradspin-uv { width: 44px; height: 44px; border-radius: 50%; background: conic-gradient(from 0deg, transparent, #667eea); animation: spin-uv 0.8s linear infinite; -webkit-mask: radial-gradient(farthest-side, transparent 60%, #000 61%); mask: radial-gradient(farthest-side, transparent 60%, #000 61%); }\n@keyframes spin-uv { to { transform: rotate(360deg); } }`,
  },
  {
    id: "loader-dots-fade",
    name: "Fading Dots",
    author: "barisdogansutcu",
    html: `<div class="fade-dots-uv"><span></span><span></span><span></span><span></span></div>`,
    css: `.fade-dots-uv { display: flex; gap: 8px; }\n.fade-dots-uv span { width: 10px; height: 10px; background: #a855f7; border-radius: 50%; animation: fadedot-uv 1.2s ease-in-out infinite; }\n.fade-dots-uv span:nth-child(2) { animation-delay: 0.15s; }\n.fade-dots-uv span:nth-child(3) { animation-delay: 0.3s; }\n.fade-dots-uv span:nth-child(4) { animation-delay: 0.45s; }\n@keyframes fadedot-uv { 0%, 100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }`,
  },
  {
    id: "loader-cube",
    name: "Cube Flip",
    author: "alexmaracinaru",
    html: `<div class="cube-uv"></div>`,
    css: `.cube-uv { width: 30px; height: 30px; background: #667eea; animation: cube-uv 1.2s ease-in-out infinite; }\n@keyframes cube-uv { 0% { transform: rotate(0) scale(1); } 25% { transform: rotate(90deg) scale(0.5); } 50% { transform: rotate(180deg) scale(1); } 75% { transform: rotate(270deg) scale(0.5); } 100% { transform: rotate(360deg) scale(1); } }`,
  },
  {
    id: "loader-ripple",
    name: "Ripple",
    author: "sahilxkhadka",
    html: `<div class="ripple-uv"><div></div><div></div></div>`,
    css: `.ripple-uv { position: relative; width: 44px; height: 44px; }\n.ripple-uv div { position: absolute; border: 3px solid #667eea; border-radius: 50%; animation: ripple-anim-uv 1.5s ease-out infinite; }\n.ripple-uv div:nth-child(2) { animation-delay: 0.5s; }\n@keyframes ripple-anim-uv { 0% { width: 0; height: 0; top: 50%; left: 50%; opacity: 1; } 100% { width: 100%; height: 100%; top: 0; left: 0; opacity: 0; } }`,
  },
  {
    id: "loader-text",
    name: "Loading Text",
    author: "martinval11",
    html: `<div class="load-text-uv">Loading<span class="load-dots-uv">...</span></div>`,
    css: `.load-text-uv { color: #fff; font-size: 1rem; font-family: system-ui, sans-serif; font-weight: 500; }\n.load-dots-uv { animation: loadtext-uv 1.5s steps(4, end) infinite; overflow: hidden; display: inline-block; vertical-align: bottom; width: 0; }\n@keyframes loadtext-uv { 0% { width: 0; } 100% { width: 1.5em; } }`,
  },
  {
    id: "loader-infinity",
    name: "Infinity",
    author: "Yaya12085",
    html: `<div class="infinity-uv"><div class="inf-left-uv"></div><div class="inf-right-uv"></div></div>`,
    css: `.infinity-uv { position: relative; width: 60px; height: 30px; }\n.inf-left-uv, .inf-right-uv { position: absolute; width: 30px; height: 30px; border: 3px solid #667eea; border-radius: 50%; }\n.inf-left-uv { left: 0; border-color: #667eea transparent transparent #667eea; animation: inf-l-uv 1.5s linear infinite; }\n.inf-right-uv { right: 0; border-color: transparent #a855f7 #a855f7 transparent; animation: inf-r-uv 1.5s linear infinite; }\n@keyframes inf-l-uv { 0% { transform: rotate(0); } 100% { transform: rotate(360deg); } }\n@keyframes inf-r-uv { 0% { transform: rotate(0); } 100% { transform: rotate(-360deg); } }`,
  },
  {
    id: "loader-neon-circle",
    name: "Neon Ring",
    author: "zanina-yassine",
    html: `<div class="neon-ring-uv"></div>`,
    css: `.neon-ring-uv { width: 40px; height: 40px; border: 3px solid transparent; border-top-color: #0ff; border-radius: 50%; animation: spin-uv 0.8s linear infinite; box-shadow: 0 0 10px #0ff4; }\n@keyframes spin-uv { to { transform: rotate(360deg); } }`,
  },
  {
    id: "loader-scale-dots",
    name: "Scale Dots",
    author: "gharsh11032000",
    html: `<div class="scale-dots-uv"><span></span><span></span><span></span></div>`,
    css: `.scale-dots-uv { display: flex; gap: 6px; align-items: center; }\n.scale-dots-uv span { width: 12px; height: 12px; background: #667eea; border-radius: 50%; animation: scale-dot-uv 1s ease-in-out infinite; }\n.scale-dots-uv span:nth-child(2) { animation-delay: 0.15s; background: #a855f7; }\n.scale-dots-uv span:nth-child(3) { animation-delay: 0.3s; background: #f093fb; }\n@keyframes scale-dot-uv { 0%, 100% { transform: scale(0.5); } 50% { transform: scale(1.2); } }`,
  },
  {
    id: "loader-chase",
    name: "Chase",
    author: "itsKrish01",
    html: `<div class="chase-uv"><span></span><span></span><span></span></div>`,
    css: `.chase-uv { position: relative; width: 40px; height: 40px; animation: spin-uv 2s linear infinite; }\n.chase-uv span { position: absolute; width: 10px; height: 10px; background: #667eea; border-radius: 50%; animation: chase-dot-uv 2s ease-in-out infinite; }\n.chase-uv span:nth-child(1) { top: 0; left: 50%; transform: translateX(-50%); }\n.chase-uv span:nth-child(2) { bottom: 0; left: 0; animation-delay: 0.3s; }\n.chase-uv span:nth-child(3) { bottom: 0; right: 0; animation-delay: 0.6s; }\n@keyframes chase-dot-uv { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.3); } }\n@keyframes spin-uv { to { transform: rotate(360deg); } }`,
  },
  {
    id: "loader-flip-card",
    name: "Card Flip",
    author: "FColombati",
    html: `<div class="flip-loader-uv"></div>`,
    css: `.flip-loader-uv { width: 32px; height: 32px; background: #667eea; animation: flip-ld-uv 1.2s ease-in-out infinite; }\n@keyframes flip-ld-uv { 0% { transform: perspective(120px) rotateX(0) rotateY(0); } 50% { transform: perspective(120px) rotateX(-180.1deg) rotateY(0); } 100% { transform: perspective(120px) rotateX(-180deg) rotateY(-179.9deg); } }`,
  },
  {
    id: "loader-dots-line",
    name: "Dots Line",
    author: "Spacious74",
    html: `<div class="dots-line-uv"><span></span><span></span><span></span><span></span><span></span></div>`,
    css: `.dots-line-uv { display: flex; gap: 4px; }\n.dots-line-uv span { width: 6px; height: 6px; background: #888; border-radius: 50%; animation: dotline-uv 1s ease infinite; }\n.dots-line-uv span:nth-child(1) { animation-delay: 0s; }\n.dots-line-uv span:nth-child(2) { animation-delay: 0.1s; }\n.dots-line-uv span:nth-child(3) { animation-delay: 0.2s; }\n.dots-line-uv span:nth-child(4) { animation-delay: 0.3s; }\n.dots-line-uv span:nth-child(5) { animation-delay: 0.4s; }\n@keyframes dotline-uv { 0%, 100% { background: #888; } 50% { background: #667eea; } }`,
  },
  {
    id: "loader-pendulum",
    name: "Pendulum",
    author: "bandirevanth",
    html: `<div class="pendulum-uv"><span></span></div>`,
    css: `.pendulum-uv { width: 60px; height: 4px; background: #333; border-radius: 2px; position: relative; }\n.pendulum-uv span { position: absolute; top: -6px; left: 0; width: 16px; height: 16px; background: #667eea; border-radius: 50%; animation: pend-uv 1.5s ease-in-out infinite; }\n@keyframes pend-uv { 0%, 100% { left: 0; } 50% { left: calc(100% - 16px); } }`,
  },
  {
    id: "loader-heartbeat",
    name: "Heartbeat",
    author: "Ashon-G",
    html: `<div class="heartbeat-uv">♥</div>`,
    css: `.heartbeat-uv { font-size: 2rem; color: #ef4444; animation: heartbeat-anim-uv 1s ease infinite; }\n@keyframes heartbeat-anim-uv { 0% { transform: scale(1); } 15% { transform: scale(1.3); } 30% { transform: scale(1); } 45% { transform: scale(1.2); } 60%, 100% { transform: scale(1); } }`,
  },
  {
    id: "loader-clock",
    name: "Clock",
    author: "cssbuttons-io",
    html: `<div class="clock-uv"><div class="clock-hand-uv"></div></div>`,
    css: `.clock-uv { width: 36px; height: 36px; border: 3px solid #555; border-radius: 50%; position: relative; }\n.clock-hand-uv { position: absolute; width: 2px; height: 14px; background: #667eea; top: 4px; left: 50%; transform-origin: bottom center; transform: translateX(-50%); animation: clock-uv-anim 2s linear infinite; }\n@keyframes clock-uv-anim { to { transform: translateX(-50%) rotate(360deg); } }`,
  },
  {
    id: "loader-3-circles",
    name: "Three Circles",
    author: "mrhyddenn",
    html: `<div class="three-circles-uv"><span></span><span></span><span></span></div>`,
    css: `.three-circles-uv { display: flex; gap: 6px; }\n.three-circles-uv span { width: 14px; height: 14px; border: 2px solid #667eea; border-radius: 50%; animation: tcircle-uv 1.2s ease infinite; }\n.three-circles-uv span:nth-child(2) { animation-delay: 0.2s; border-color: #a855f7; }\n.three-circles-uv span:nth-child(3) { animation-delay: 0.4s; border-color: #f093fb; }\n@keyframes tcircle-uv { 0%, 100% { transform: scale(0.8); opacity: 0.5; } 50% { transform: scale(1.2); opacity: 1; } }`,
  },
];

const FORM_TEMPLATES: UITemplate[] = [
  {
    id: "form-login",
    name: "Login Form",
    author: "adamgiebl",
    html: `<div class="login-form-uv">\n  <h3>Sign In</h3>\n  <div class="lf-group-uv"><label>Email</label><input type="email" placeholder="you@example.com"></div>\n  <div class="lf-group-uv"><label>Password</label><input type="password" placeholder="••••••••"></div>\n  <button class="lf-btn-uv">Sign In</button>\n  <p class="lf-footer-uv">Don't have an account? <a href="#">Sign up</a></p>\n</div>`,
    css: `.login-form-uv { background: #1e1e1e; border-radius: 16px; padding: 30px; width: 280px; font-family: system-ui, sans-serif; color: #fff; }\n.login-form-uv h3 { font-size: 1.2rem; margin-bottom: 20px; text-align: center; }\n.lf-group-uv { margin-bottom: 14px; }\n.lf-group-uv label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 6px; }\n.lf-group-uv input { width: 100%; padding: 10px 12px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; box-sizing: border-box; transition: border-color 0.2s; }\n.lf-group-uv input:focus { border-color: #667eea; }\n.lf-btn-uv { width: 100%; padding: 11px; border: none; border-radius: 8px; background: #667eea; color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; margin-top: 6px; transition: background 0.2s; }\n.lf-btn-uv:hover { background: #5a6fd6; }\n.lf-footer-uv { text-align: center; font-size: 0.75rem; color: #888; margin-top: 14px; }\n.lf-footer-uv a { color: #667eea; text-decoration: none; }`,
  },
  {
    id: "form-search",
    name: "Search Bar",
    author: "vinodjangid07",
    html: `<div class="search-form-uv">\n  <svg class="sf-icon-uv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>\n  <input class="sf-input-uv" placeholder="Search...">\n</div>`,
    css: `.search-form-uv { display: flex; align-items: center; gap: 10px; background: #1e1e1e; border: 1px solid #333; border-radius: 50px; padding: 10px 18px; width: 280px; transition: border-color 0.3s; }\n.search-form-uv:focus-within { border-color: #667eea; }\n.sf-icon-uv { width: 18px; height: 18px; color: #888; flex-shrink: 0; }\n.sf-input-uv { flex: 1; background: transparent; border: none; color: #fff; font-size: 0.9rem; outline: none; font-family: system-ui, sans-serif; }`,
  },
  {
    id: "form-float-label",
    name: "Floating Label",
    author: "gharsh11032000",
    html: `<div class="float-label-uv">\n  <input class="fl-input-uv" placeholder=" " id="fl1">\n  <label class="fl-label-uv" for="fl1">Username</label>\n</div>`,
    css: `.float-label-uv { position: relative; width: 260px; }\n.fl-input-uv { width: 100%; padding: 16px 12px 6px; background: #1e1e1e; border: 1px solid #444; border-radius: 8px; color: #fff; font-size: 0.9rem; outline: none; box-sizing: border-box; transition: border-color 0.3s; font-family: system-ui, sans-serif; }\n.fl-input-uv:focus { border-color: #667eea; }\n.fl-label-uv { position: absolute; left: 12px; top: 12px; font-size: 0.85rem; color: #888; transition: 0.2s; pointer-events: none; font-family: system-ui, sans-serif; }\n.fl-input-uv:focus + .fl-label-uv, .fl-input-uv:not(:placeholder-shown) + .fl-label-uv { top: 4px; font-size: 0.65rem; color: #667eea; }`,
  },
  {
    id: "form-contact",
    name: "Contact Form",
    author: "mrhyddenn",
    html: `<div class="contact-form-uv">\n  <h3>Get in Touch</h3>\n  <input class="cf-input-uv" placeholder="Your name">\n  <input class="cf-input-uv" placeholder="Email address">\n  <textarea class="cf-textarea-uv" placeholder="Your message"></textarea>\n  <button class="cf-btn-uv">Send Message</button>\n</div>`,
    css: `.contact-form-uv { background: #1e1e1e; border-radius: 16px; padding: 28px; width: 280px; font-family: system-ui, sans-serif; color: #fff; }\n.contact-form-uv h3 { font-size: 1.1rem; margin-bottom: 18px; }\n.cf-input-uv, .cf-textarea-uv { width: 100%; padding: 10px 12px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; margin-bottom: 12px; box-sizing: border-box; font-family: system-ui, sans-serif; transition: border-color 0.2s; }\n.cf-textarea-uv { height: 80px; resize: none; }\n.cf-input-uv:focus, .cf-textarea-uv:focus { border-color: #667eea; }\n.cf-btn-uv { width: 100%; padding: 11px; border: none; border-radius: 8px; background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: transform 0.2s; }\n.cf-btn-uv:hover { transform: translateY(-2px); }`,
  },
  {
    id: "form-newsletter",
    name: "Newsletter",
    author: "cssbuttons-io",
    html: `<div class="newsletter-form-uv">\n  <h4>Subscribe to our newsletter</h4>\n  <div class="nf-row-uv">\n    <input class="nf-input-uv" placeholder="Enter your email">\n    <button class="nf-btn-uv">Subscribe</button>\n  </div>\n</div>`,
    css: `.newsletter-form-uv { background: #1a1a2e; border-radius: 16px; padding: 24px; width: 320px; font-family: system-ui, sans-serif; color: #fff; }\n.newsletter-form-uv h4 { font-size: 0.95rem; margin-bottom: 14px; }\n.nf-row-uv { display: flex; gap: 8px; }\n.nf-input-uv { flex: 1; padding: 10px 14px; background: #0d1117; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; }\n.nf-input-uv:focus { border-color: #667eea; }\n.nf-btn-uv { padding: 10px 18px; background: #667eea; border: none; border-radius: 8px; color: #fff; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background 0.2s; }\n.nf-btn-uv:hover { background: #5a6fd6; }`,
  },
  {
    id: "form-otp",
    name: "OTP Input",
    author: "Pradeepsaranbishnoi",
    html: `<div class="otp-form-uv">\n  <h4>Enter verification code</h4>\n  <div class="otp-boxes-uv">\n    <input maxlength="1" class="otp-box-uv" value="4">\n    <input maxlength="1" class="otp-box-uv" value="2">\n    <input maxlength="1" class="otp-box-uv">\n    <input maxlength="1" class="otp-box-uv">\n  </div>\n  <button class="otp-btn-uv">Verify</button>\n</div>`,
    css: `.otp-form-uv { background: #1e1e1e; border-radius: 16px; padding: 28px; text-align: center; width: 260px; font-family: system-ui, sans-serif; color: #fff; }\n.otp-form-uv h4 { font-size: 0.9rem; margin-bottom: 18px; }\n.otp-boxes-uv { display: flex; justify-content: center; gap: 10px; margin-bottom: 18px; }\n.otp-box-uv { width: 44px; height: 50px; background: #111; border: 2px solid #333; border-radius: 10px; color: #fff; font-size: 1.3rem; text-align: center; outline: none; font-family: system-ui, sans-serif; transition: border-color 0.2s; }\n.otp-box-uv:focus { border-color: #667eea; }\n.otp-btn-uv { padding: 10px 32px; background: #667eea; border: none; border-radius: 8px; color: #fff; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }\n.otp-btn-uv:hover { background: #5a6fd6; }`,
  },
  {
    id: "form-file-upload",
    name: "File Upload",
    author: "JkHuger",
    html: `<div class="fu-form-uv">\n  <div class="fu-drop-uv">\n    <span class="fu-icon-uv">📁</span>\n    <p>Drag & drop or <span class="fu-link-uv">browse</span></p>\n    <span class="fu-hint-uv">PNG, JPG, PDF up to 10MB</span>\n  </div>\n</div>`,
    css: `.fu-form-uv { width: 280px; }\n.fu-drop-uv { border: 2px dashed #444; border-radius: 12px; padding: 36px; text-align: center; background: #1e1e1e; cursor: pointer; transition: border-color 0.3s; color: #fff; font-family: system-ui, sans-serif; }\n.fu-drop-uv:hover { border-color: #667eea; }\n.fu-icon-uv { font-size: 2rem; display: block; margin-bottom: 10px; }\n.fu-drop-uv p { font-size: 0.85rem; color: #aaa; margin-bottom: 6px; }\n.fu-link-uv { color: #667eea; cursor: pointer; }\n.fu-hint-uv { font-size: 0.7rem; color: #666; }`,
  },
  {
    id: "form-select",
    name: "Custom Select",
    author: "Nawsome",
    html: `<div class="csel-form-uv">\n  <label class="csel-label-uv">Country</label>\n  <div class="csel-wrap-uv">\n    <select class="csel-select-uv">\n      <option>United States</option>\n      <option>United Kingdom</option>\n      <option>Germany</option>\n      <option>Japan</option>\n    </select>\n    <span class="csel-arrow-uv">▾</span>\n  </div>\n</div>`,
    css: `.csel-form-uv { width: 260px; font-family: system-ui, sans-serif; }\n.csel-label-uv { display: block; font-size: 0.75rem; color: #888; margin-bottom: 6px; }\n.csel-wrap-uv { position: relative; }\n.csel-select-uv { width: 100%; padding: 10px 36px 10px 12px; background: #1e1e1e; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; appearance: none; outline: none; cursor: pointer; transition: border-color 0.2s; }\n.csel-select-uv:focus { border-color: #667eea; }\n.csel-arrow-uv { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: #888; pointer-events: none; font-size: 0.85rem; }`,
  },
  {
    id: "form-password-strength",
    name: "Password Strength",
    author: "portseif",
    html: `<div class="ps-form-uv">\n  <label>Password</label>\n  <input type="password" class="ps-input-uv" placeholder="Create a password">\n  <div class="ps-meter-uv"><div class="ps-bar-uv"></div></div>\n  <span class="ps-hint-uv">Weak password</span>\n</div>`,
    css: `.ps-form-uv { width: 260px; font-family: system-ui, sans-serif; color: #fff; }\n.ps-form-uv label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 6px; }\n.ps-input-uv { width: 100%; padding: 10px 12px; background: #1e1e1e; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; box-sizing: border-box; margin-bottom: 8px; transition: border-color 0.2s; }\n.ps-input-uv:focus { border-color: #667eea; }\n.ps-meter-uv { height: 4px; background: #333; border-radius: 2px; overflow: hidden; margin-bottom: 6px; }\n.ps-bar-uv { width: 30%; height: 100%; background: #ef4444; border-radius: 2px; transition: width 0.3s; }\n.ps-hint-uv { font-size: 0.7rem; color: #ef4444; }`,
  },
  {
    id: "form-register",
    name: "Register Form",
    author: "Smit-Prajapati",
    html: `<div class="reg-form-uv">\n  <h3>Create Account</h3>\n  <input class="reg-input-uv" placeholder="Full name">\n  <input class="reg-input-uv" type="email" placeholder="Email">\n  <input class="reg-input-uv" type="password" placeholder="Password">\n  <label class="reg-check-uv"><input type="checkbox"> I agree to the Terms</label>\n  <button class="reg-btn-uv">Register</button>\n</div>`,
    css: `.reg-form-uv { background: #1e1e1e; border: 1px solid #2a2a2a; border-radius: 16px; padding: 28px; width: 280px; font-family: system-ui, sans-serif; color: #fff; }\n.reg-form-uv h3 { font-size: 1.1rem; margin-bottom: 18px; text-align: center; }\n.reg-input-uv { width: 100%; padding: 10px 12px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; margin-bottom: 12px; box-sizing: border-box; transition: border-color 0.2s; }\n.reg-input-uv:focus { border-color: #667eea; }\n.reg-check-uv { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; color: #888; margin-bottom: 16px; cursor: pointer; }\n.reg-check-uv input { accent-color: #667eea; }\n.reg-btn-uv { width: 100%; padding: 11px; border: none; border-radius: 8px; background: #667eea; color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }\n.reg-btn-uv:hover { background: #5a6fd6; }`,
  },
  {
    id: "form-social-login",
    name: "Social Login",
    author: "SpatexDEV",
    html: `<div class="slogin-form-uv">\n  <h3>Welcome</h3>\n  <button class="slogin-google-uv">G Continue with Google</button>\n  <button class="slogin-github-uv">⚡ Continue with GitHub</button>\n  <div class="slogin-divider-uv"><span>or</span></div>\n  <input class="slogin-input-uv" placeholder="Email address">\n  <button class="slogin-btn-uv">Continue</button>\n</div>`,
    css: `.slogin-form-uv { background: #1e1e1e; border-radius: 16px; padding: 28px; width: 280px; font-family: system-ui, sans-serif; color: #fff; text-align: center; }\n.slogin-form-uv h3 { font-size: 1.1rem; margin-bottom: 18px; }\n.slogin-google-uv, .slogin-github-uv { width: 100%; padding: 10px; border: 1px solid #333; border-radius: 8px; background: transparent; color: #fff; font-size: 0.85rem; cursor: pointer; margin-bottom: 10px; transition: background 0.2s; font-family: system-ui, sans-serif; }\n.slogin-google-uv:hover, .slogin-github-uv:hover { background: #2a2a2a; }\n.slogin-divider-uv { display: flex; align-items: center; gap: 12px; margin: 14px 0; color: #555; font-size: 0.75rem; }\n.slogin-divider-uv::before, .slogin-divider-uv::after { content: ""; flex: 1; height: 1px; background: #333; }\n.slogin-input-uv { width: 100%; padding: 10px 12px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; margin-bottom: 12px; box-sizing: border-box; }\n.slogin-input-uv:focus { border-color: #667eea; }\n.slogin-btn-uv { width: 100%; padding: 11px; border: none; border-radius: 8px; background: #667eea; color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; }`,
  },
  {
    id: "form-range",
    name: "Range Slider",
    author: "elijahgummer",
    html: `<div class="range-form-uv">\n  <label>Volume: <span class="range-val-uv">75%</span></label>\n  <input type="range" class="range-input-uv" value="75" min="0" max="100">\n</div>`,
    css: `.range-form-uv { width: 240px; font-family: system-ui, sans-serif; color: #fff; }\n.range-form-uv label { display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 8px; color: #aaa; }\n.range-val-uv { color: #667eea; font-weight: 600; }\n.range-input-uv { width: 100%; -webkit-appearance: none; height: 6px; background: #333; border-radius: 3px; outline: none; }\n.range-input-uv::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; background: #667eea; border-radius: 50%; cursor: pointer; box-shadow: 0 0 6px #667eea60; }`,
  },
  {
    id: "form-textarea",
    name: "Rich Textarea",
    author: "TaniaDou",
    html: `<div class="rta-form-uv">\n  <label>Message</label>\n  <textarea class="rta-input-uv" placeholder="Write your message here..."></textarea>\n  <div class="rta-footer-uv"><span>0/500</span><button class="rta-send-uv">Send</button></div>\n</div>`,
    css: `.rta-form-uv { width: 280px; font-family: system-ui, sans-serif; color: #fff; }\n.rta-form-uv label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 6px; }\n.rta-input-uv { width: 100%; height: 100px; padding: 12px; background: #1e1e1e; border: 1px solid #333; border-radius: 10px; color: #fff; font-size: 0.85rem; outline: none; resize: none; box-sizing: border-box; font-family: system-ui, sans-serif; transition: border-color 0.2s; }\n.rta-input-uv:focus { border-color: #667eea; }\n.rta-footer-uv { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }\n.rta-footer-uv span { font-size: 0.7rem; color: #666; }\n.rta-send-uv { padding: 6px 16px; background: #667eea; border: none; border-radius: 6px; color: #fff; font-size: 0.8rem; cursor: pointer; transition: background 0.2s; }\n.rta-send-uv:hover { background: #5a6fd6; }`,
  },
  {
    id: "form-date-picker",
    name: "Date Input",
    author: "Ali-Tahmazi99",
    html: `<div class="date-form-uv">\n  <label>Select Date</label>\n  <div class="date-wrap-uv">\n    <input type="date" class="date-input-uv">\n    <span class="date-icon-uv">📅</span>\n  </div>\n</div>`,
    css: `.date-form-uv { width: 240px; font-family: system-ui, sans-serif; color: #fff; }\n.date-form-uv label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 6px; }\n.date-wrap-uv { position: relative; }\n.date-input-uv { width: 100%; padding: 10px 40px 10px 12px; background: #1e1e1e; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; box-sizing: border-box; color-scheme: dark; }\n.date-input-uv:focus { border-color: #667eea; }\n.date-icon-uv { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; }`,
  },
  {
    id: "form-checkout",
    name: "Checkout Form",
    author: "barisdogansutcu",
    html: `<div class="checkout-form-uv">\n  <h3>Payment</h3>\n  <input class="co-input-uv" placeholder="Card number">\n  <div class="co-row-uv">\n    <input class="co-input-uv" placeholder="MM/YY">\n    <input class="co-input-uv" placeholder="CVV">\n  </div>\n  <button class="co-btn-uv">Pay $29.00</button>\n</div>`,
    css: `.checkout-form-uv { background: #1e1e1e; border-radius: 16px; padding: 28px; width: 280px; font-family: system-ui, sans-serif; color: #fff; }\n.checkout-form-uv h3 { font-size: 1rem; margin-bottom: 16px; }\n.co-input-uv { width: 100%; padding: 10px 12px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; margin-bottom: 10px; box-sizing: border-box; transition: border-color 0.2s; }\n.co-input-uv:focus { border-color: #667eea; }\n.co-row-uv { display: flex; gap: 10px; }\n.co-btn-uv { width: 100%; padding: 12px; border: none; border-radius: 10px; background: linear-gradient(135deg, #10b981, #059669); color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; margin-top: 4px; transition: transform 0.2s; }\n.co-btn-uv:hover { transform: translateY(-2px); }`,
  },
  {
    id: "form-search-filter",
    name: "Search + Filter",
    author: "alexmaracinaru",
    html: `<div class="sf-form-uv">\n  <div class="sf-bar-uv">\n    <input class="sf-input-uv" placeholder="Search products...">\n    <button class="sf-filter-uv">⚙️</button>\n  </div>\n  <div class="sf-tags-uv">\n    <span class="sf-tag-uv active">All</span>\n    <span class="sf-tag-uv">New</span>\n    <span class="sf-tag-uv">Popular</span>\n    <span class="sf-tag-uv">Sale</span>\n  </div>\n</div>`,
    css: `.sf-form-uv { width: 300px; font-family: system-ui, sans-serif; }\n.sf-bar-uv { display: flex; gap: 8px; margin-bottom: 12px; }\n.sf-input-uv { flex: 1; padding: 10px 14px; background: #1e1e1e; border: 1px solid #333; border-radius: 10px; color: #fff; font-size: 0.85rem; outline: none; }\n.sf-input-uv:focus { border-color: #667eea; }\n.sf-filter-uv { width: 40px; background: #1e1e1e; border: 1px solid #333; border-radius: 10px; cursor: pointer; font-size: 1rem; transition: background 0.2s; }\n.sf-filter-uv:hover { background: #2a2a2a; }\n.sf-tags-uv { display: flex; gap: 8px; }\n.sf-tag-uv { padding: 6px 14px; background: #222; border-radius: 20px; font-size: 0.75rem; color: #888; cursor: pointer; transition: 0.2s; }\n.sf-tag-uv.active { background: #667eea; color: #fff; }`,
  },
  {
    id: "form-rating-input",
    name: "Rating Input",
    author: "sahilxkhadka",
    html: `<div class="ri-form-uv">\n  <p>How was your experience?</p>\n  <div class="ri-stars-uv">★ ★ ★ ★ ★</div>\n  <textarea class="ri-text-uv" placeholder="Leave a comment..."></textarea>\n  <button class="ri-btn-uv">Submit Review</button>\n</div>`,
    css: `.ri-form-uv { background: #1e1e1e; border-radius: 16px; padding: 24px; width: 260px; text-align: center; font-family: system-ui, sans-serif; color: #fff; }\n.ri-form-uv p { font-size: 0.9rem; margin-bottom: 12px; }\n.ri-stars-uv { font-size: 1.5rem; color: #fbbf24; letter-spacing: 6px; margin-bottom: 14px; cursor: pointer; }\n.ri-text-uv { width: 100%; height: 60px; padding: 10px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.8rem; outline: none; resize: none; box-sizing: border-box; margin-bottom: 12px; font-family: system-ui, sans-serif; }\n.ri-btn-uv { padding: 8px 20px; background: #667eea; border: none; border-radius: 8px; color: #fff; font-size: 0.85rem; cursor: pointer; }`,
  },
  {
    id: "form-settings",
    name: "Settings Form",
    author: "martinval11",
    html: `<div class="settings-form-uv">\n  <h3>Settings</h3>\n  <div class="set-row-uv"><span>Notifications</span><label class="set-sw-uv"><input type="checkbox" checked><span></span></label></div>\n  <div class="set-row-uv"><span>Dark Mode</span><label class="set-sw-uv"><input type="checkbox" checked><span></span></label></div>\n  <div class="set-row-uv"><span>Auto-save</span><label class="set-sw-uv"><input type="checkbox"><span></span></label></div>\n  <button class="set-btn-uv">Save Changes</button>\n</div>`,
    css: `.settings-form-uv { background: #1e1e1e; border-radius: 16px; padding: 24px; width: 260px; font-family: system-ui, sans-serif; color: #fff; }\n.settings-form-uv h3 { font-size: 1rem; margin-bottom: 18px; }\n.set-row-uv { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #222; font-size: 0.85rem; }\n.set-sw-uv { position: relative; display: inline-block; width: 40px; height: 22px; }\n.set-sw-uv input { opacity: 0; width: 0; height: 0; }\n.set-sw-uv span { position: absolute; cursor: pointer; inset: 0; background: #444; border-radius: 22px; transition: 0.3s; }\n.set-sw-uv span::before { content: ""; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.3s; }\n.set-sw-uv input:checked + span { background: #667eea; }\n.set-sw-uv input:checked + span::before { transform: translateX(18px); }\n.set-btn-uv { width: 100%; padding: 10px; border: none; border-radius: 8px; background: #667eea; color: #fff; font-size: 0.85rem; font-weight: 600; cursor: pointer; margin-top: 18px; }`,
  },
  {
    id: "form-address",
    name: "Address Form",
    author: "Yaya12085",
    html: `<div class="addr-form-uv">\n  <h3>Shipping Address</h3>\n  <input class="addr-input-uv" placeholder="Street address">\n  <div class="addr-row-uv">\n    <input class="addr-input-uv" placeholder="City">\n    <input class="addr-input-uv" placeholder="ZIP">\n  </div>\n  <input class="addr-input-uv" placeholder="Country">\n  <button class="addr-btn-uv">Save Address</button>\n</div>`,
    css: `.addr-form-uv { background: #1e1e1e; border-radius: 16px; padding: 28px; width: 300px; font-family: system-ui, sans-serif; color: #fff; }\n.addr-form-uv h3 { font-size: 1rem; margin-bottom: 16px; }\n.addr-input-uv { width: 100%; padding: 10px 12px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; margin-bottom: 10px; box-sizing: border-box; transition: border-color 0.2s; }\n.addr-input-uv:focus { border-color: #667eea; }\n.addr-row-uv { display: flex; gap: 10px; }\n.addr-btn-uv { width: 100%; padding: 11px; border: none; border-radius: 8px; background: #667eea; color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; margin-top: 4px; }`,
  },
  {
    id: "form-comment",
    name: "Comment Box",
    author: "Spacious74",
    html: `<div class="comment-form-uv">\n  <div class="cm-header-uv">\n    <div class="cm-avatar-uv">J</div>\n    <strong>John</strong>\n  </div>\n  <textarea class="cm-text-uv" placeholder="Write a comment..."></textarea>\n  <div class="cm-footer-uv">\n    <span>😀 📎</span>\n    <button class="cm-btn-uv">Post</button>\n  </div>\n</div>`,
    css: `.comment-form-uv { background: #1e1e1e; border: 1px solid #2a2a2a; border-radius: 12px; padding: 16px; width: 300px; font-family: system-ui, sans-serif; color: #fff; }\n.cm-header-uv { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }\n.cm-avatar-uv { width: 32px; height: 32px; border-radius: 50%; background: #667eea; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8rem; }\n.cm-header-uv strong { font-size: 0.85rem; }\n.cm-text-uv { width: 100%; height: 60px; padding: 10px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.8rem; outline: none; resize: none; box-sizing: border-box; font-family: system-ui, sans-serif; }\n.cm-text-uv:focus { border-color: #667eea; }\n.cm-footer-uv { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }\n.cm-footer-uv span { font-size: 1rem; cursor: pointer; }\n.cm-btn-uv { padding: 6px 16px; background: #667eea; border: none; border-radius: 6px; color: #fff; font-size: 0.8rem; cursor: pointer; }`,
  },
  {
    id: "form-invite",
    name: "Invite Form",
    author: "bandirevanth",
    html: `<div class="invite-form-uv">\n  <h4>Invite teammates</h4>\n  <div class="inv-row-uv">\n    <input class="inv-input-uv" placeholder="colleague@company.com">\n    <button class="inv-btn-uv">Invite</button>\n  </div>\n  <div class="inv-list-uv">\n    <div class="inv-item-uv"><span class="inv-dot-uv"></span>alex@co.com<span class="inv-status-uv">Pending</span></div>\n    <div class="inv-item-uv"><span class="inv-dot-uv sent"></span>maria@co.com<span class="inv-status-uv sent">Joined</span></div>\n  </div>\n</div>`,
    css: `.invite-form-uv { background: #1e1e1e; border-radius: 16px; padding: 24px; width: 300px; font-family: system-ui, sans-serif; color: #fff; }\n.invite-form-uv h4 { font-size: 0.95rem; margin-bottom: 14px; }\n.inv-row-uv { display: flex; gap: 8px; margin-bottom: 16px; }\n.inv-input-uv { flex: 1; padding: 9px 12px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.8rem; outline: none; }\n.inv-btn-uv { padding: 9px 16px; background: #667eea; border: none; border-radius: 8px; color: #fff; font-size: 0.8rem; cursor: pointer; white-space: nowrap; }\n.inv-list-uv { display: flex; flex-direction: column; gap: 8px; }\n.inv-item-uv { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: #aaa; padding: 8px; background: #161616; border-radius: 8px; }\n.inv-dot-uv { width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; flex-shrink: 0; }\n.inv-dot-uv.sent { background: #4ade80; }\n.inv-status-uv { margin-left: auto; font-size: 0.7rem; color: #fbbf24; }\n.inv-status-uv.sent { color: #4ade80; }`,
  },
  {
    id: "form-coupon",
    name: "Coupon Input",
    author: "itsKrish01",
    html: `<div class="coupon-form-uv">\n  <label>Promo Code</label>\n  <div class="cp-row-uv">\n    <input class="cp-input-uv" placeholder="Enter code">\n    <button class="cp-btn-uv">Apply</button>\n  </div>\n</div>`,
    css: `.coupon-form-uv { width: 260px; font-family: system-ui, sans-serif; color: #fff; }\n.coupon-form-uv label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 6px; }\n.cp-row-uv { display: flex; gap: 8px; }\n.cp-input-uv { flex: 1; padding: 10px 12px; background: #1e1e1e; border: 2px dashed #444; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; font-family: monospace; letter-spacing: 2px; }\n.cp-input-uv:focus { border-color: #667eea; }\n.cp-btn-uv { padding: 10px 18px; background: #667eea; border: none; border-radius: 8px; color: #fff; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; }`,
  },
  {
    id: "form-phone",
    name: "Phone Input",
    author: "Ashon-G",
    html: `<div class="phone-form-uv">\n  <label>Phone Number</label>\n  <div class="ph-wrap-uv">\n    <span class="ph-prefix-uv">+1</span>\n    <input class="ph-input-uv" placeholder="(555) 000-0000">\n  </div>\n</div>`,
    css: `.phone-form-uv { width: 260px; font-family: system-ui, sans-serif; color: #fff; }\n.phone-form-uv label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 6px; }\n.ph-wrap-uv { display: flex; background: #1e1e1e; border: 1px solid #333; border-radius: 8px; overflow: hidden; transition: border-color 0.2s; }\n.ph-wrap-uv:focus-within { border-color: #667eea; }\n.ph-prefix-uv { padding: 10px 12px; background: #161616; border-right: 1px solid #333; color: #888; font-size: 0.85rem; display: flex; align-items: center; }\n.ph-input-uv { flex: 1; padding: 10px 12px; background: transparent; border: none; color: #fff; font-size: 0.85rem; outline: none; }`,
  },
  {
    id: "form-profile-edit",
    name: "Profile Edit",
    author: "FColombati",
    html: `<div class="profile-edit-uv">\n  <div class="pe-avatar-uv">👤</div>\n  <input class="pe-input-uv" placeholder="Display name" value="John Doe">\n  <input class="pe-input-uv" placeholder="Bio" value="UI Designer">\n  <button class="pe-btn-uv">Save Profile</button>\n</div>`,
    css: `.profile-edit-uv { background: #1e1e1e; border-radius: 16px; padding: 28px; width: 260px; text-align: center; font-family: system-ui, sans-serif; color: #fff; }\n.pe-avatar-uv { width: 64px; height: 64px; border-radius: 50%; background: #333; margin: 0 auto 18px; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; cursor: pointer; }\n.pe-input-uv { width: 100%; padding: 10px 12px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.85rem; outline: none; margin-bottom: 10px; box-sizing: border-box; text-align: center; }\n.pe-input-uv:focus { border-color: #667eea; }\n.pe-btn-uv { width: 100%; padding: 10px; border: none; border-radius: 8px; background: #667eea; color: #fff; font-size: 0.85rem; font-weight: 600; cursor: pointer; margin-top: 4px; }`,
  },
  {
    id: "form-feedback",
    name: "Feedback Form",
    author: "MuhammadHasann",
    html: `<div class="feedback-form-uv">\n  <h3>Send Feedback</h3>\n  <div class="fb-emojis-uv">\n    <span>😡</span><span>😕</span><span class="active">😊</span><span>😍</span>\n  </div>\n  <textarea class="fb-text-uv" placeholder="Tell us more..."></textarea>\n  <button class="fb-btn-uv">Submit</button>\n</div>`,
    css: `.feedback-form-uv { background: #1e1e1e; border-radius: 16px; padding: 24px; width: 260px; font-family: system-ui, sans-serif; color: #fff; text-align: center; }\n.feedback-form-uv h3 { font-size: 1rem; margin-bottom: 16px; }\n.fb-emojis-uv { display: flex; justify-content: center; gap: 14px; margin-bottom: 18px; }\n.fb-emojis-uv span { font-size: 1.5rem; cursor: pointer; opacity: 0.4; transition: 0.2s; }\n.fb-emojis-uv span.active { opacity: 1; transform: scale(1.2); }\n.fb-emojis-uv span:hover { opacity: 0.8; }\n.fb-text-uv { width: 100%; height: 70px; padding: 10px; background: #111; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 0.8rem; outline: none; resize: none; box-sizing: border-box; margin-bottom: 12px; font-family: system-ui, sans-serif; }\n.fb-btn-uv { padding: 8px 28px; background: #667eea; border: none; border-radius: 8px; color: #fff; font-size: 0.85rem; cursor: pointer; }`,
  },
  {
    id: "form-url-input",
    name: "URL Input",
    author: "cssbuttons-io",
    html: `<div class="url-form-uv">\n  <label>Website</label>\n  <div class="url-wrap-uv">\n    <span class="url-prefix-uv">https://</span>\n    <input class="url-input-uv" placeholder="example.com">\n  </div>\n</div>`,
    css: `.url-form-uv { width: 280px; font-family: system-ui, sans-serif; color: #fff; }\n.url-form-uv label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 6px; }\n.url-wrap-uv { display: flex; background: #1e1e1e; border: 1px solid #333; border-radius: 8px; overflow: hidden; transition: border-color 0.2s; }\n.url-wrap-uv:focus-within { border-color: #667eea; }\n.url-prefix-uv { padding: 10px 10px; background: #161616; border-right: 1px solid #333; color: #667eea; font-size: 0.8rem; display: flex; align-items: center; font-family: monospace; white-space: nowrap; }\n.url-input-uv { flex: 1; padding: 10px; background: transparent; border: none; color: #fff; font-size: 0.85rem; outline: none; font-family: monospace; }`,
  },
  {
    id: "form-tags-input",
    name: "Tags Input",
    author: "gharsh11032000",
    html: `<div class="tags-form-uv">\n  <label>Tags</label>\n  <div class="tags-box-uv">\n    <span class="tag-item-uv">React <span class="tag-x-uv">×</span></span>\n    <span class="tag-item-uv">CSS <span class="tag-x-uv">×</span></span>\n    <input class="tag-input-uv" placeholder="Add tag...">\n  </div>\n</div>`,
    css: `.tags-form-uv { width: 280px; font-family: system-ui, sans-serif; color: #fff; }\n.tags-form-uv label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 6px; }\n.tags-box-uv { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; background: #1e1e1e; border: 1px solid #333; border-radius: 8px; min-height: 40px; align-items: center; }\n.tags-box-uv:focus-within { border-color: #667eea; }\n.tag-item-uv { display: flex; align-items: center; gap: 4px; padding: 4px 10px; background: #667eea30; border-radius: 6px; font-size: 0.75rem; color: #667eea; }\n.tag-x-uv { cursor: pointer; font-size: 0.85rem; opacity: 0.7; }\n.tag-x-uv:hover { opacity: 1; }\n.tag-input-uv { flex: 1; min-width: 80px; background: transparent; border: none; color: #fff; font-size: 0.8rem; outline: none; padding: 4px; }`,
  },
  {
    id: "form-color-input",
    name: "Color Input",
    author: "vinodjangid07",
    html: `<div class="color-form-uv">\n  <label>Brand Color</label>\n  <div class="clr-wrap-uv">\n    <input type="color" class="clr-picker-uv" value="#667eea">\n    <input class="clr-hex-uv" value="#667eea">\n  </div>\n</div>`,
    css: `.color-form-uv { width: 240px; font-family: system-ui, sans-serif; color: #fff; }\n.color-form-uv label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 6px; }\n.clr-wrap-uv { display: flex; gap: 10px; align-items: center; background: #1e1e1e; border: 1px solid #333; border-radius: 8px; padding: 6px 10px; }\n.clr-picker-uv { width: 32px; height: 32px; border: none; border-radius: 6px; cursor: pointer; padding: 0; background: none; }\n.clr-hex-uv { flex: 1; background: transparent; border: none; color: #fff; font-size: 0.85rem; outline: none; font-family: monospace; }`,
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
    case "cards": return CARD_TEMPLATES;
    case "toggles": return TOGGLE_TEMPLATES;
    case "loaders": return LOADER_TEMPLATES;
    case "forms": return FORM_TEMPLATES;
    default: return [];
  }
}

function TemplatePreviewCard({ t, onInsert, scaled }: { t: UITemplate; onInsert: (html: string, css: string) => void; scaled?: boolean }) {
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
      <div style={{ height: scaled ? 180 : 160, overflow: 'hidden', position: 'relative' }}>
        <iframe
          ref={iframeRef}
          srcDoc={previewHtml}
          style={scaled ? { width: '200%', height: '200%', border: 'none', pointerEvents: 'none', transform: 'scale(0.5)', transformOrigin: 'top left' } : { width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
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

export const STYLE_PICKER_TEMPLATES: UITemplate[] = [
  ...BUTTON_TEMPLATES,
  ...CARD_TEMPLATES,
  ...TOGGLE_TEMPLATES,
  ...LOADER_TEMPLATES,
  ...FORM_TEMPLATES,
];

export const STYLE_PICKER_BY_CATEGORY: Record<string, UITemplate[]> = {
  "Все": STYLE_PICKER_TEMPLATES,
  "Кнопки": BUTTON_TEMPLATES,
  "Карточки": CARD_TEMPLATES,
  "Тогглы": TOGGLE_TEMPLATES,
  "Лоадеры": LOADER_TEMPLATES,
  "Формы": FORM_TEMPLATES,
};

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
                    <TemplatePreviewCard key={t.id} t={t} onInsert={onInsert} scaled={activeCategory === 'cards' || activeCategory === 'forms' || activeCategory === 'loaders'} />
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

Role: Act as a World-Class Senior Creative Technologist and Lead Frontend Engineer. Objective: Architect a high-fidelity, cinematic "1:1 Pixel Perfect" landing page for Nura Health. Aesthetic Identity: "High-End Organic Tech" / "Clinical Boutique." The site should feel like a bridge between a biological research lab and an avant-garde luxury magazine.
1. CORE DESIGN SYSTEM (STRICT)
Palette: Moss (Primary): #2E4036Clay (Accent): #CC5833Cream (Background): #F2F0E9Charcoal (Text/Dark sections): #1A1A1A
Typography: Headings: "Plus Jakarta Sans" & "Outfit" (Tracking tight). Drama/Emphasis: "Cormorant Garamond" (Must use Italic for biological/organic concepts). Data: A clean Monospace font for clinical telemetry.
Visual Texture: Implement a global CSS Noise overlay (SVG turbulence at 0.05 opacity) to eliminate flat digital gradients. Use a rounded-[2rem] to rounded-[3rem] radius system for all containers.
2. COMPONENT ARCHITECTURE & BEHAVIOR
A. NAVBAR (The Floating Island)
A fixed, pill-shaped pill container.
Morphing Logic: Transparent with white text at the hero top. Transitions into a white/60 glassmorphic blur with moss text and a subtle border upon scrolling.
B. HERO SECTION (Nature is the Algorithm)
Visuals: 100dvh height. Background image of a moody, dark forest (https://images.unsplash.com/photo-1470115636492-6d2b56f9146d) with a heavy Moss-to-Black gradient overlay.
Layout: Content pushed to the bottom-left third.
Typography: Large scale contrast. "Nature is the" (Bold Sans) vs. "Algorithm." (Massive Serif Italic).
Animation: GSAP staggered fade-up for all text parts.
C. FEATURES (The Precision Micro-UI Dashboard)
Replace standard cards with Interactive Functional Artifacts.
Card 1 (Audit Intelligence): Implement a "Diagnostic Shuffler." 3 overlapping white cards that cycle vertically using unshift(pop()) logic. Every 3 seconds, they rotate with a spring-bounce transition (cubic-bezier(0.34, 1.56, 0.64, 1)). Labels: "Epigenetic Age", "Microbiome Score", "Cortisol Optimization".
Card 2 (Neural Stream): Implement a "Telemetry Typewriter." A live text feed that cycles through messages like "Optimizing Circadian Rhythm..." with a blinking clay cursor. Include a small "Live Feed" pulsing dot.
Card 3 (Adaptive Regimen): A "Mock Cursor Protocol Scheduler." A weekly grid (S M T W T F S) where an automated SVG cursor enters, moves to a day, clicks (visual scale-down), activates the day, then moves to a "Save" button before fading out.
D. PHILOSOPHY (The Manifesto)
A high-contrast Charcoal section with a parallaxing organic texture (https://images.unsplash.com/photo-1542601906990-b4d3fb778b09).
Text Layout: Huge typography comparison. "Modern medicine asks: What is wrong?" vs. "We ask: What is optimal?" using split-text GSAP reveals.
E. PROTOCOL (Sticky Stacking Archive)
Vertical stack of 3 full-screen cards.
Stacking Interaction: Using GSAP ScrollTrigger, as a new card scrolls into view, the card underneath must scale down to 0.9, increase its blur filter to 20px, and fade its opacity to 0.5.
Artifacts: Each card contains a unique animation: A rotating double-helix gear. A scanning laser-grid over a grid of medical cells. A pulsing EKG waveform path.
F. MEMBERSHIP & FOOTER
Three-tier pricing grid. The middle card ("Performance") should "pop" with a Moss background and Clay button.
Footer: Deep Charcoal, rounded-t-[4rem]. Include high-end utility links and a "System Operational" status indicator with a pulsing green dot.
3. TECHNICAL REQUIREMENTS
Tech Stack: React 19, Tailwind CSS, GSAP 3 (with ScrollTrigger), Lucide React.
Animation Lifecycle: Use gsap.context() within useEffect for all animations to ensure clean mounting/unmounting.
Micro-Interactions: Buttons must have a "magnetic" feel (subtle scale-up on hover) and utilize overflow-hidden with a sliding background layer for color transitions.
Code Quality: No placeholders. Use real image URLs from Unsplash. Ensure the dashboard cards in the Features section feel like functional software, not just static layouts.
Execution Directive: "Do not build a website; build a digital instrument. Every scroll should feel intentional, every animation should feel weighted and professional. Eradicate all generic AI patterns"
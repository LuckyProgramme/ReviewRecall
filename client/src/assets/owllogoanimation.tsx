import React, { useState, useEffect, useRef } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { Play, Pause, RotateCcw } from 'lucide-react';

const LOGO_COLOR = '#8D5A3C';
const BG_COLOR = '#F7F6F1';
const STROKE_WIDTH = 16;

const AnimatedLogo = ({ controls }) => {
  // SVG Path Data Setup
  const leftStem = "M 70 50 L 70 350";
  const rightStem = "M 330 50 L 330 350";
  const beak = "M 148 197.2 L 200 320 L 252 197.2";
  
  // Custom easing for smooth, professional motion
  const drawEase = [0.25, 1, 0.5, 1];

  // Outlines (Stems, Circles, Beak)
  const outlineVariants = {
    hidden: { pathLength: 0, opacity: 0 },
    traced: (custom) => ({
      pathLength: 1,
      opacity: 1,
      transition: {
        duration: custom.duration || 1.5,
        ease: drawEase,
        delay: custom.delay || 0
      }
    })
  };

  // Pupil
  const pupilVariants = {
    hidden: { scale: 0, opacity: 0 },
    traced: { scale: 0, opacity: 0 },
    visible: { 
      scale: 1, 
      opacity: 1, 
      transition: { type: "spring", stiffness: 350, damping: 15 }
    }
  };

  // Equalizer Bars Data & Variants
  const eqBars = [
    { id: 'outer-left', x: 226, y1: 123, y2: 157, delay: 0.2, keyframes: [1, 0.6, 1.2, 0.4, 1.1, 1] },
    { id: 'inner-left', x: 248, y1: 110, y2: 170, delay: 0.1, keyframes: [1, 1.3, 0.5, 1.2, 0.7, 1] },
    { id: 'center',     x: 270, y1: 100, y2: 180, delay: 0.0, keyframes: [1, 0.4, 1.3, 0.6, 1.2, 1] },
    { id: 'inner-right',x: 292, y1: 110, y2: 170, delay: 0.1, keyframes: [1, 1.1, 0.6, 1.3, 0.5, 1] },
    { id: 'outer-right',x: 314, y1: 123, y2: 157, delay: 0.2, keyframes: [1, 0.5, 1.1, 0.4, 1.2, 1] },
  ];

  const eqVariants = {
    hidden: { scaleY: 0, opacity: 0 },
    traced: { scaleY: 0, opacity: 0 },
    visible: (custom) => ({
      scaleY: 1,
      opacity: 1,
      transition: {
        type: "spring",
        stiffness: 400,
        damping: 20,
        delay: custom.delay
      }
    }),
    looping: (custom) => ({
      scaleY: custom.keyframes,
      transition: {
        duration: 1.5,
        repeat: Infinity,
        ease: "easeInOut",
        times: [0, 0.2, 0.4, 0.6, 0.8, 1]
      }
    })
  };

  return (
    <motion.div
      initial="hidden"
      animate={controls}
      className="w-full max-w-[400px] aspect-square flex items-center justify-center relative"
      // Subtle continuous float effect after entrance
      whileInView={{
        y: [0, -6, 0],
        transition: { duration: 6, repeat: Infinity, ease: "easeInOut", delay: 3 }
      }}
    >
      <svg
        viewBox="0 0 400 400"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-sm overflow-visible"
        style={{ color: LOGO_COLOR }}
      >
        {/* Left Stem */}
        <motion.path
          d={leftStem}
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          variants={outlineVariants}
          custom={{ delay: 0.0, duration: 1.2 }}
        />
        
        {/* Right Stem */}
        <motion.path
          d={rightStem}
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          variants={outlineVariants}
          custom={{ delay: 0.2, duration: 1.2 }}
        />

        {/* Left Circle (Eye) */}
        <motion.circle
          cx="130"
          cy="140"
          r="60"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          variants={outlineVariants}
          custom={{ delay: 0.4, duration: 1.5 }}
          // Start drawing from top center (-90deg in SVG)
          transform="rotate(-90 130 140)" 
        />

        {/* Right Circle (Eye) */}
        <motion.circle
          cx="270"
          cy="140"
          r="60"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          variants={outlineVariants}
          custom={{ delay: 0.5, duration: 1.5 }}
          transform="rotate(-90 270 140)"
        />

        {/* Beak / Mask Bottom */}
        <motion.path
          d={beak}
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          variants={outlineVariants}
          custom={{ delay: 0.8, duration: 1.0 }}
        />

        {/* Left Pupil */}
        <motion.circle
          cx="130"
          cy="140"
          r="22"
          fill="currentColor"
          variants={pupilVariants}
          style={{ transformOrigin: "130px 140px" }}
        />

        {/* Right Eye Equalizer */}
        {eqBars.map((bar) => (
          <motion.line
            key={bar.id}
            x1={bar.x}
            y1={bar.y1}
            x2={bar.x}
            y2={bar.y2}
            stroke="currentColor"
            strokeWidth={12} // Slightly thinner than main strokes for inner detail
            strokeLinecap="round"
            variants={eqVariants}
            custom={{ delay: bar.delay, keyframes: bar.keyframes }}
            style={{ transformOrigin: `${bar.x}px 140px` }}
          />
        ))}
      </svg>
    </motion.div>
  );
};

export default function App() {
  const controls = useAnimation();
  const [isPlaying, setIsPlaying] = useState(true);
  const [isAnimatingIntro, setIsAnimatingIntro] = useState(false);
  const isFirstMount = useRef(true);

  const runIntroSequence = async () => {
    if (isAnimatingIntro) return;
    setIsAnimatingIntro(true);
    
    // Reset immediately
    await controls.start("hidden", { duration: 0 });
    
    // Trace outer lines
    controls.start("traced");
    
    // Wait for the paths to almost finish drawing
    await new Promise(r => setTimeout(r, 1600));
    
    // Pop in the inner elements (pupil & eq bars)
    await controls.start("visible");
    
    setIsAnimatingIntro(false);
  };

  useEffect(() => {
    runIntroSequence();
  }, []);

  useEffect(() => {
    // Manage equalizer state based on play/pause, but only after intro finishes
    if (!isAnimatingIntro && !isFirstMount.current) {
      if (isPlaying) {
        controls.start("looping");
      } else {
        // Smoothly return to default scale 1 state when paused
        controls.start("visible");
      }
    }
    
    if (!isAnimatingIntro) {
      isFirstMount.current = false;
      // If we just finished intro and play state is true, start looping
      if (isPlaying) {
        controls.start("looping");
      }
    }
  }, [isPlaying, isAnimatingIntro, controls]);

  const handleReplay = () => {
    if (!isAnimatingIntro) {
      runIntroSequence();
    }
  };

  return (
    <div 
      className="min-h-screen flex flex-col items-center justify-center font-sans antialiased overflow-hidden"
      style={{ backgroundColor: BG_COLOR }}
    >
      
      {/* Decorative subtle background grid/pattern just to frame it nicely */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #8D5A3C 1px, transparent 0)', backgroundSize: '32px 32px' }} />

      <div className="relative flex flex-col items-center z-10 w-full max-w-2xl px-6">
        
        {/* Main Logo Container */}
        <AnimatedLogo controls={controls} />

        {/* UI Controls */}
        <div className="mt-16 flex items-center gap-6 bg-white/40 backdrop-blur-md px-8 py-4 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50">
          
          <button 
            onClick={handleReplay}
            disabled={isAnimatingIntro}
            className="text-[#8D5A3C]/70 hover:text-[#8D5A3C] transition-colors p-3 rounded-full hover:bg-white/60 disabled:opacity-50 disabled:cursor-not-allowed group relative"
            aria-label="Replay animation"
          >
            <RotateCcw size={22} className="group-hover:-rotate-90 transition-transform duration-500" />
            <span className="sr-only">Replay</span>
          </button>

          <div className="w-[1px] h-8 bg-[#8D5A3C]/10" />

          <button 
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={isAnimatingIntro}
            className="flex items-center justify-center w-14 h-14 bg-[#8D5A3C] text-[#F7F6F1] rounded-full shadow-lg shadow-[#8D5A3C]/30 hover:scale-105 hover:bg-[#7a4d32] active:scale-95 transition-all duration-300 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
            aria-label={isPlaying ? "Pause equalizer" : "Play equalizer"}
          >
            {isPlaying ? (
              <Pause fill="currentColor" size={24} className="ml-[1px]" />
            ) : (
              <Play fill="currentColor" size={24} className="ml-1" />
            )}
          </button>
          
        </div>
        
        <p className="mt-6 text-sm font-medium tracking-widest uppercase opacity-40" style={{ color: LOGO_COLOR }}>
          Audio Visual Studio
        </p>

      </div>
    </div>
  );
}
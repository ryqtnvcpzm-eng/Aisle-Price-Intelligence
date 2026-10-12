"use client";

import { motion } from "motion/react";
import { ease } from "@/components/motion/tokens";

/**
 * Page transition: a quick settle (160 ms fade, 4 px rise). Kept short on
 * purpose — it stacks with the view-transition crossfade on morph
 * navigations, and the destination must arrive *with* the moving image, not
 * after it.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: ease.out }}>
      {children}
    </motion.div>
  );
}

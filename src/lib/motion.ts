import type { Transition, Variants } from 'motion/react'

// Единые токены движения (синхронны с --dur-* в tokens.css).
// Правила: 150–300мс, выход ≈ 65% входа, только transform/opacity.

export const dur = { fast: 0.15, base: 0.2, slow: 0.3 } as const
export const easeOut = [0.22, 1, 0.36, 1] as const
export const easeIn = [0.55, 0, 1, 0.45] as const

export const spring: Transition = { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }
export const springSoft: Transition = { type: 'spring', stiffness: 260, damping: 28 }

/** Появление страницы: без exit, чтобы не блокировать навигацию. */
export const pageEnter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease: easeOut } },
}

export const listParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035 } },
}

export const listItem: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: dur.base, ease: easeOut } },
}

export const fadeScale = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: spring },
  exit: { opacity: 0, scale: 0.98, transition: { duration: dur.base * 0.65, ease: easeIn } },
}

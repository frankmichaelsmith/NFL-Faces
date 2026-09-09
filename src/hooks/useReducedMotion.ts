import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** True when the OS asks for reduced motion. Safe where matchMedia is missing (tests). */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => window.matchMedia?.(QUERY).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const onChange = () => setReduce(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduce
}

import { GAME_CONFIG } from './game/config'

// M0 placeholder. The real screens (Start / Play / Game over) arrive in M3.
export default function App() {
  const wheels = GAME_CONFIG.wheels.map((w) => w.label).join(' · ')
  return (
    <main className="mx-auto flex h-full max-w-[720px] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-5xl font-black tracking-tight">NFL Faces</h1>
      <p className="text-lg text-white/70">Tap the face that matches the wheels. Five seconds.</p>
      <p className="text-sm text-white/40">M0 scaffold · wheels: {wheels}</p>
    </main>
  )
}

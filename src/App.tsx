import { Scene } from './scene/Scene'

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Scene />
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          color: '#ddd',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
          pointerEvents: 'none',
        }}
      >
        <strong>robo-sims</strong> — M0: drag the resistor, orbit with the mouse
      </div>
    </div>
  )
}

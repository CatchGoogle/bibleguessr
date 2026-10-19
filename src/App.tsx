import { Route, Routes } from 'react-router-dom'
import { Host } from './pages/Host.tsx'
import { Play } from './pages/Play.tsx'
import { Watch } from './pages/Watch.tsx'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Play />} />
      <Route path="/play" element={<Play />} />
      <Route path="/view" element={<Watch />} />
      <Route path="/view/preview" element={<Watch preview />} />
      <Route path="/av6" element={<Host />} />
    </Routes>
  )
}

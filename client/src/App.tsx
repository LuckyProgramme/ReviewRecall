import { StudyHeader } from './components/StudyHeader'
import { UploadScreen } from './features/upload/UploadScreen'

export default function App() {
  return (
    <div className="flex min-h-dvh flex-col bg-study-glow px-4 sm:px-6">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:z-10 focus:rounded-lg focus:bg-paper focus:p-3"
      >
        Skip to content
      </a>
      <StudyHeader />
      <UploadScreen />
    </div>
  )
}

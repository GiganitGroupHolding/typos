import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
      <p className="text-[17px] font-semibold">Такой страницы нет</p>
      <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
        На главную
      </Link>
    </div>
  )
}

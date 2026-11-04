import { SpreadsheetBook } from "./spreadsheetData"
import type { SpreadsheetReply, SpreadsheetRequest } from "./spreadsheetProtocol"

const scope = self as unknown as { postMessage: (message: SpreadsheetReply, transfer?: Transferable[]) => void }
let book: SpreadsheetBook | null = null

addEventListener("message", (event: MessageEvent<SpreadsheetRequest>) => {
  void handle(event.data)
})

async function handle(request: SpreadsheetRequest) {
  try {
    if (request.type === "open") {
      book = null
      book = new SpreadsheetBook(request.data)
      await book.loadAppearance()
      scope.postMessage({ type: "opened", names: book.names })
    } else if (request.type === "window" && book) {
      const window = book.window(request.sheet, request.row, request.col, request.rows, request.cols, request.layout ?? true)
      scope.postMessage({ type: "window", id: request.id, window })
    } else if (request.type === "preview" && book) {
      const image = book.preview(request.sheet, request.zoom, request.top, request.left, request.width, request.height)
      scope.postMessage({ type: "preview", id: request.id, image }, [image])
    }
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Не удалось открыть таблицу. Проверь файл в Excel.",
    })
  }
}

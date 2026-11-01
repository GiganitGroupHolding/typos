type FsaPermissionMode = 'read' | 'readwrite'

interface FileSystemHandle {
  queryPermission(desc?: { mode?: FsaPermissionMode }): Promise<PermissionState>
  requestPermission(desc?: { mode?: FsaPermissionMode }): Promise<PermissionState>
  move?(parent: FileSystemDirectoryHandle, name: string): Promise<void>
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
}

interface Window {
  showDirectoryPicker?(options?: {
    id?: string
    mode?: FsaPermissionMode
    startIn?: 'desktop' | 'documents' | 'downloads'
  }): Promise<FileSystemDirectoryHandle>
}

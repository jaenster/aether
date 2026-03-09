export interface ModuleInfo {
  path: string;
  source: string;
  deps: string[];
}

export interface FileRequest {
  type: "file:request";
  id: string;
  path: string;
}

export interface FileResponse {
  type: "file:response";
  id: string;
  modules?: ModuleInfo[];
  error?: string;
  message?: string;
}

export interface FileInvalidate {
  type: "file:invalidate";
  paths: string[];
}

export interface FileRawRequest {
  type: "file:raw";
  id: string;
  path: string;
}

export interface FileRawResponse {
  type: "file:raw:response";
  id: string;
  content?: string;
  error?: string;
}

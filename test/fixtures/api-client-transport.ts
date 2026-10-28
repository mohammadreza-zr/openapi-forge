import { createClient, type RequestConfig } from "@mrzr/api-client";

export const api = createClient({ baseUrl: "https://api.example.com", worker: false });

// The types the generated code imports.
export type GeneratedRequestConfig<T = unknown> = Omit<
  RequestConfig<T>,
  "params" | "addTemplateToUrl" | "fullData" | "isFormData"
>;
export type ApiEnvelope<T> = { result: boolean; code?: number; message?: unknown; data: T };
export type ApiListData<T> = { count: number; list: T[] };

/** One part per list item, a JSON part per object, a file as it is. */
function toFormData(fields: object) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item == null) continue;
      form.append(name, item instanceof Blob ? item : typeof item === "object" ? JSON.stringify(item) : String(item));
    }
  }
  return form;
}

/** The generated code hands over a plain object: the wire format is the adapter's to choose. */
function send<T>(body: unknown, config?: RequestConfig<T>): [unknown, RequestConfig<T>] {
  const type = config?.headers?.["Content-Type"] ?? "";
  if (body == null) return [undefined, { ...config }];
  if (config?.isFormData) return [toFormData(body), { ...config }];
  if (type.startsWith("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(body)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item != null) form.append(name, String(item));
      }
    }
    return [form.toString(), { ...config, stringifyBody: false }];
  }
  // Text and bytes: sent as they are.
  if (type && !type.includes("json")) return [body, { ...config, stringifyBody: false }];
  return [body, { ...config }];
}

export const apiGet = async <T>(route: string, config?: RequestConfig<T>) =>
  (await api.get<T>(route, { ...config, throwError: true })).data as T;
export const apiDelete = async <T>(route: string, config?: RequestConfig<T>) =>
  (await api.delete<T>(route, { ...config, throwError: true })).data as T;

const withBody =
  (verb: "post" | "put" | "patch") =>
  async <T>(route: string, body: unknown, config?: RequestConfig<T>) => {
    const [data, own] = send(body, config);
    return (await api[verb]<T>(route, data, { ...own, throwError: true })).data as T;
  };
export const apiPost = withBody("post");
export const apiPut = withBody("put");
export const apiPatch = withBody("patch");

import type {
  AnalysisHttpClient,
  AnalysisHttpResponse
} from "./providers/openai-compatible-analysis-provider";

type RequestUrlLike = (request: {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  throw?: boolean;
}) => Promise<{
  status: number;
  json: unknown;
}>;

export function createRequestUrlHttpClient(
  requestUrl: RequestUrlLike
): AnalysisHttpClient {
  return async (url, request): Promise<AnalysisHttpResponse> => {
    const { "Content-Type": contentType, ...headers } = request.headers;
    const response = await requestUrl({
      url,
      method: request.method,
      contentType,
      headers,
      body: request.body,
      throw: false
    });

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.json
    };
  };
}

export const RequestMethods = ['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const;
export type RequestMethod = typeof RequestMethods[number];

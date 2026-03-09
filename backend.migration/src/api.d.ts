import { ApiRequest } from '@motiadev/plugin-endpoint'

declare module '@motiadev/plugin-endpoint' {
  interface ApiRequest {
    user?: {
      userId: string
      email: string
      role?: string
    }
    apiKey?: {
      id: string
      name: string
      userId: string
    }
  }
}

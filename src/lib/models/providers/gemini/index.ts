import { UIConfigField } from '@/lib/config/types';
import { getConfiguredModelProviderById } from '@/lib/config/serverRegistry';
import { Model, ModelList, ProviderMetadata } from '../../types';
import GeminiEmbedding from './geminiEmbedding';
import BaseEmbedding from '../../base/embedding';
import BaseModelProvider from '../../base/provider';
import BaseLLM from '../../base/llm';
import GeminiLLM from './geminiLLM';

interface GeminiConfig {
  apiKey: string;
  baseURL?: string;
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const providerConfigFields: UIConfigField[] = [
  {
    type: 'password',
    name: 'API Key / OAuth Token',
    key: 'apiKey',
    description: 'Gemini API key or OAuth access token (for antigravity)',
    required: true,
    placeholder: 'Gemini API Key or OAuth Token',
    env: 'GEMINI_API_KEY',
    scope: 'server',
  },
  {
    type: 'string',
    name: 'Base URL',
    key: 'baseURL',
    description: 'Custom API base URL (leave empty for default Gemini API)',
    required: false,
    placeholder: 'https://generativelanguage.googleapis.com/v1beta',
    scope: 'server',
  },
];

class GeminiProvider extends BaseModelProvider<GeminiConfig> {
  constructor(id: string, name: string, config: GeminiConfig) {
    super(id, name, config);
  }

  async getDefaultModels(): Promise<ModelList> {
    const base = this.config.baseURL || DEFAULT_BASE_URL;
    const isBearer = !this.config.apiKey.startsWith('AIza');
    const url = isBearer
      ? `${base}/models`
      : `${base}/models?key=${this.config.apiKey}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (isBearer) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    let data: any = {};
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        data = await res.json();
      }
    } catch {
      // Model listing unavailable (e.g. antigravity proxy) — fall through to config models
    }

    let defaultEmbeddingModels: Model[] = [];
    let defaultChatModels: Model[] = [];

    const models = data.models || [];
    models.forEach((m: any) => {
      if (
        m.supportedGenerationMethods?.some(
          (genMethod: string) =>
            genMethod === 'embedText' || genMethod === 'embedContent',
        )
      ) {
        defaultEmbeddingModels.push({
          key: m.name,
          name: m.displayName,
        });
      } else if (m.supportedGenerationMethods?.includes('generateContent')) {
        defaultChatModels.push({
          key: m.name,
          name: m.displayName,
        });
      }
    });

    return {
      embedding: defaultEmbeddingModels,
      chat: defaultChatModels,
    };
  }

  async getModelList(): Promise<ModelList> {
    const defaultModels = await this.getDefaultModels();
    const configProvider = getConfiguredModelProviderById(this.id)!;

    return {
      embedding: [
        ...defaultModels.embedding,
        ...configProvider.embeddingModels,
      ],
      chat: [...defaultModels.chat, ...configProvider.chatModels],
    };
  }

  async loadChatModel(key: string): Promise<BaseLLM<any>> {
    const modelList = await this.getModelList();

    const exists = modelList.chat.find((m) => m.key === key);

    if (!exists) {
      throw new Error(
        'Error Loading Gemini Chat Model. Invalid Model Selected',
      );
    }

    const base = this.config.baseURL || DEFAULT_BASE_URL;
    return new GeminiLLM({
      apiKey: this.config.apiKey,
      model: key,
      baseURL: `${base}/openai`,
    });
  }

  async loadEmbeddingModel(key: string): Promise<BaseEmbedding<any>> {
    const modelList = await this.getModelList();
    const exists = modelList.embedding.find((m) => m.key === key);

    if (!exists) {
      throw new Error(
        'Error Loading Gemini Embedding Model. Invalid Model Selected.',
      );
    }

    const base = this.config.baseURL || DEFAULT_BASE_URL;
    return new GeminiEmbedding({
      apiKey: this.config.apiKey,
      model: key,
      baseURL: `${base}/openai`,
    });
  }

  static parseAndValidate(raw: any): GeminiConfig {
    if (!raw || typeof raw !== 'object')
      throw new Error('Invalid config provided. Expected object');
    if (!raw.apiKey)
      throw new Error('Invalid config provided. API key must be provided');

    const config: GeminiConfig = {
      apiKey: String(raw.apiKey),
    };
    if (raw.baseURL) {
      config.baseURL = String(raw.baseURL).replace(/\/+$/, '');
    }
    return config;
  }

  static getProviderConfigFields(): UIConfigField[] {
    return providerConfigFields;
  }

  static getProviderMetadata(): ProviderMetadata {
    return {
      key: 'gemini',
      name: 'Gemini',
    };
  }
}

export default GeminiProvider;

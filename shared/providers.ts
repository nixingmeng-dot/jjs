import type { ProviderKind } from './types';

export interface ProviderPreset {
  key: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  models: string[];
  keyUrl?: string;
  noKey?: boolean;
  hint?: string;
}

/** 常见服务商预设。模型名会更新，建议在设置页点「拉取模型列表」获取最新可用模型。 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    key: 'anthropic',
    name: 'Anthropic Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [],
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    key: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: [],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    key: 'moonshot',
    name: 'Kimi（月之暗面）',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    key: 'qwen',
    name: '通义千问（阿里云百炼）',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    keyUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    key: 'zhipu',
    name: '智谱 GLM',
    kind: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    key: 'doubao',
    name: '豆包（火山方舟）',
    kind: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [],
    keyUrl: 'https://console.volcengine.com/ark',
    hint: '模型名填写方舟控制台里的模型 ID 或推理接入点 ID（ep-xxxx）。',
  },
  {
    key: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    kind: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [],
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    key: 'ollama',
    name: 'Ollama（本地模型）',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
    noKey: true,
    hint: '先在本机运行 ollama serve，再点「拉取模型列表」。',
  },
  {
    key: 'custom',
    name: '自定义（OpenAI 兼容接口）',
    kind: 'openai',
    baseUrl: '',
    models: [],
    hint: '任何兼容 OpenAI /chat/completions 的中转或自部署服务都可以接入。',
  },
];

export const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

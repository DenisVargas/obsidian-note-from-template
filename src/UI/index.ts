/**
 * UI module barrel: centralizes all UI exports.
 * Import from this module to access all UI components, utilities, and types.
 */

// Types
export type { SubcontrolParams } from './types.js';

// Utils and components
export { TemplateStatusView, AddTextSuggest, TagSuggest, LinkSuggest } from './utils.js';

// Modals
export { TemplateInputModal } from './TemplateInputModal.js';
export { FolderCreateModal } from './FolderCreateModal.js';

// Panes
export { FT_SettingTab } from './SettingsPane.js';

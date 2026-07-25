import {
  DEFAULT_TRANSLATION_EXPERT_ID,
  type TranslationExpert,
  type TranslationExpertImportPreview,
  type TranslationExpertImportRequest,
  type TranslationExpertList,
  type TranslationExpertMutationResult,
  type TranslationExpertPreviewRequest,
  type TranslationExpertRemoveRequest,
} from '../../../shared/contracts/translation-expert.types';
import {
  TRANSLATION_ERROR_CODES,
  TranslationError,
} from '../../../shared/errors/translation.errors';
import { compileUserExpertYaml } from '../experts/ExpertCompiler';
import { TranslationExpertStore } from '../stores/TranslationExpertStore';

export interface ResolvedTranslationExpert {
  id: string;
  contentHash: string;
  expert?: TranslationExpert;
}

export class TranslationExpertService {
  constructor(private readonly store: TranslationExpertStore) {}

  list(): TranslationExpertList {
    return { experts: this.store.list() };
  }

  preview(request: TranslationExpertPreviewRequest): TranslationExpertImportPreview {
    const preview = compileUserExpertYaml(request.yaml);
    const id = preview.expert?.id;
    if (!id) return preview;
    if (this.store.isBuiltIn(id)) {
      return {
        ...preview,
        valid: false,
        errors: [...preview.errors, `Built-in expert ID \`${id}\` is immutable.`],
      };
    }
    return {
      ...preview,
      replacesExistingUserExpert: Boolean(this.store.findUser(id)),
    };
  }

  import(request: TranslationExpertImportRequest): TranslationExpertMutationResult {
    const preview = this.preview({ yaml: request.yaml });
    if (!preview.valid || !preview.expert) {
      throw invalidExpert(preview.errors[0] ?? 'The AI expert YAML is invalid.');
    }
    if (preview.replacesExistingUserExpert && request.replace !== true) {
      throw invalidExpert(
        `User expert \`${preview.expert.id}\` already exists. Confirm replacement to continue.`,
      );
    }
    const expert = this.store.saveUser(preview.expert, request.yaml);
    return { expertId: expert.id };
  }

  remove(request: TranslationExpertRemoveRequest): TranslationExpertMutationResult {
    if (this.store.isBuiltIn(request.id)) {
      throw invalidExpert('Built-in AI experts cannot be removed.');
    }
    if (!this.store.removeUser(request.id)) {
      throw invalidExpert('The user AI expert does not exist.');
    }
    return { expertId: request.id };
  }

  resolve(id: string | undefined): ResolvedTranslationExpert {
    const normalizedId = id?.trim() || DEFAULT_TRANSLATION_EXPERT_ID;
    if (normalizedId === DEFAULT_TRANSLATION_EXPERT_ID) {
      return {
        id: DEFAULT_TRANSLATION_EXPERT_ID,
        contentHash: DEFAULT_TRANSLATION_EXPERT_ID,
      };
    }
    const expert = this.store.find(normalizedId);
    if (!expert) {
      throw invalidExpert(`AI expert \`${normalizedId}\` is not available.`);
    }
    return {
      id: expert.id,
      contentHash: expert.contentHash,
      expert,
    };
  }
}

function invalidExpert(message: string): TranslationError {
  return new TranslationError(
    TRANSLATION_ERROR_CODES.TRANSLATION_INVALID_REQUEST,
    message,
    false,
  );
}

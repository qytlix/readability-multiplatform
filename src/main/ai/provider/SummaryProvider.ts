/**
 * @deprecated Import the provider-neutral names from TextGenerationProvider.
 * These aliases keep existing feature tests and downstream branches source
 * compatible while the implementation no longer depends on Summary naming.
 */
export type {
  TextGenerationProvider as SummaryProvider,
  TextGenerationProviderRequest as SummaryProviderRequest,
} from './TextGenerationProvider';

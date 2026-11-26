import type { z } from 'zod';
import type { siteDocumentEditSchema } from '../../../contracts/site.js';

/** A policy as the defaults write it: the edited shape, before defaults are applied. */
export type SiteDocumentInput = z.input<typeof siteDocumentEditSchema>;

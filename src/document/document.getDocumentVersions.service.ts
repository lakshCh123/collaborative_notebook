
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class DocumentHistoryService {
  private readonly logger = new Logger(DocumentHistoryService.name);

  constructor(
    private readonly databaseService: DatabaseService,
  ) {}

  async getDocumentVersions(documentId: string) {
    // Check whether the document exists
    const { data: document, error: documentError } =
      await this.databaseService.supabase
        .from('documents')
        .select('id')
        .eq('id', documentId)
        .maybeSingle();

    if (documentError) {
      this.logger.error(
        `Error checking document ${documentId}: ${documentError.message}`,
      );

      throw new InternalServerErrorException(
        documentError.message,
      );
    }

    if (!document) {
      throw new NotFoundException(
        `Notebook ${documentId} was not found`,
      );
    }

    // Fetch all previous versions of the document
    const { data: versions, error: versionsError } =
      await this.databaseService.supabase
        .from('document_versions')
        .select('*')
        .eq('document_id', documentId)
        .order('version_number', {
          ascending: false,
        });

    if (versionsError) {
      this.logger.error(
        `Error fetching versions for ${documentId}: ${versionsError.message}`,
      );

      throw new InternalServerErrorException(
        versionsError.message,
      );
    }

    this.logger.log(
      `Retrieved ${versions.length} versions for document ${documentId}`,
    );

    return {
      message: 'Document versions retrieved successfully',
      documentId,
      totalVersions: versions.length,
      versions,
    };
  }
}

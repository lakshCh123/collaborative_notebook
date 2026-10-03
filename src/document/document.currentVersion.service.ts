import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class DocumentCurrentVersionService {
  private readonly logger = new Logger(
    DocumentCurrentVersionService.name,
  );

  constructor(
    private readonly databaseService: DatabaseService,
  ) {}

  async getDocument(documentId: string) {
    const { data: document, error: documentError } =
      await this.databaseService.supabase
        .from('documents')
        .select('*')
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
        `Document ${documentId} not found`,
      );
    }

    return {
      message: 'Current document version retrieved successfully',
      document,
    };
  }
}
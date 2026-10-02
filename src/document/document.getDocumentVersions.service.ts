import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';

import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';

@Injectable()

export class DocumentHistoryService {
  private readonly logger = new Logger(DocumentHistoryService.name);

  constructor(
    private readonly databaseService: DatabaseService,
  ) {}

  private generateRequestHash(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private async executeIdempotently<T>(
    requestId: string,
    documentId: string | null,
    payload: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    const requestHash = this.generateRequestHash(payload);

    const { data: existingRequest, error: searchError } =
      await this.databaseService.supabase
        .from('sync_requests')
        .select('*')
        .eq('request_id', requestId)
        .maybeSingle();

    if (searchError) {
      throw new InternalServerErrorException(searchError.message);
    }

    if (existingRequest) {
      if (existingRequest.request_hash !== requestHash) {
        throw new ConflictException(
          'Idempotency key reused with a different request body',
        );
      }

      if (
        existingRequest.status === 'completed' &&
        existingRequest.response !== null
      ) {
        this.logger.log(
          `Returning cached history response for request ${requestId}`,
        );

        return existingRequest.response as T;
      }

      throw new ConflictException(
        'This request is already being processed or has not completed',
      );
    }

    const { error: insertError } =
      await this.databaseService.supabase
        .from('sync_requests')
        .insert({
          request_id: requestId,
          document_id: documentId,
          request_hash: requestHash,
          status: 'processing',
        });

    if (insertError) {
      if (insertError.code === '23505') {
        throw new ConflictException(
          'This request is already being processed',
        );
      }

      throw new InternalServerErrorException(insertError.message);
    }

    try {
      const result = await operation();

      const { error: updateError } =
        await this.databaseService.supabase
          .from('sync_requests')
          .update({
            response: result,
            status: 'completed',
            processed_at: new Date().toISOString(),
          })
          .eq('request_id', requestId);

      if (updateError) {
        throw new InternalServerErrorException(updateError.message);
      }

      return result;
    } catch (error) {
      await this.databaseService.supabase
        .from('sync_requests')
        .update({ status: 'failed' })
        .eq('request_id', requestId);

      throw error;
    }
  }

  async getDocumentVersions(
    documentId: string,
    requestId: string,
  ) {
    return this.executeIdempotently(
      requestId,
      documentId,
      { documentId },
      async () => {
        // Confirm that the notebook exists.
        const { data: document, error: documentError } =
          await this.databaseService.supabase
            .from('documents')
            .select('id')
            .eq('id', documentId)
            .maybeSingle();

        if (documentError) {
          throw new InternalServerErrorException(
            documentError.message,
          );
        }

        if (!document) {
          throw new NotFoundException(
            `Notebook ${documentId} was not found`,
          );
        }

        // Fetch all historical snapshots for this notebook.
        const { data: versions, error: versionsError } =
          await this.databaseService.supabase
            .from('document_versions')
            .select('*')
            .eq('document_id', documentId)
            .order('version_number', { ascending: false });

        if (versionsError) {
          throw new InternalServerErrorException(
            versionsError.message,
          );
        }

        return {
          message: 'Document versions retrieved successfully',
          documentId,
          totalVersions: versions.length,
          versions,
        };
      },
    );
  }
}
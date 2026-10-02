import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { randomUUID, createHash } from 'node:crypto';

import { DatabaseService } from '../database/database.service.js';
import { CreateDocumentDto } from '../dto/create_document.dto.js';

const MAX_MERGE_ATTEMPTS = 3;

@Injectable()
export class DocumentCreateService {
  private readonly logger = new Logger(DocumentCreateService.name);

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

  async create(
    dto: CreateDocumentDto,
    requestId: string,
  ) {
    const documentId = dto.uuid ?? randomUUID();

    return this.executeIdempotently(
      requestId,
      documentId,
      dto,
      async () => {
        const now = new Date().toISOString();

        const subtitles = Object.fromEntries(
          dto.subtitles.map((subtitle) => {
            const subtitleId = randomUUID();

            return [
              subtitleId,
              {
                id: subtitleId,
                title: subtitle.title,
                content: subtitle.content,
                created_at: subtitle.created_at ?? now,
                updated_at: subtitle.updated_at ?? now,
                version: subtitle.version ?? 1,
              },
            ];
          }),
        );

        const { data, error } =
          await this.databaseService.supabase
            .from('documents')
            .insert({
              id: documentId,
              title: dto.title.trim(),
              subtitles,
              version: 1,
              device_id: dto.deviceId ?? null,
              created_at: now,
              updated_at: now,
            })
            .select()
            .single();

        if (error) {
          if (error.code === '23505') {
            throw new ConflictException(
              'A document with this UUID already exists',
            );
          }

          this.logger.error(
            `Failed to create document: ${error.message}`,
          );

          throw new InternalServerErrorException(error.message);
        }

        return data;
      },
    );
  }
}
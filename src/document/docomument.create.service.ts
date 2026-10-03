import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { randomUUID } from 'node:crypto';

import { DatabaseService } from '../database/database.service.js';
import { CreateDocumentDto } from '../dto/create_document.dto.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';

@Injectable()
export class DocumentCreateService {
  private readonly logger = new Logger(DocumentCreateService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async create(
    dto: CreateDocumentDto,
    requestId: string,
    deviceId: string,
  ) {
    const documentId =  randomUUID();

    return this.idempotencyService.executeIdempotently(
      requestId,
      documentId,
      deviceId,
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
                last_modified_device_id: deviceId,
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
              device_id: deviceId,
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

        const { error: historyError } =
          await this.databaseService.supabase
            .from('document_versions')
            .insert({
              document_id: data.id,
              version_number: data.version,
              title: data.title,
              subtitles: data.subtitles,
              device_id: deviceId,
            });

        if (historyError) {
          this.logger.error(
            `Failed to save initial document version: ${historyError.message}`,
          );

          throw new InternalServerErrorException(
            'Document was created, but its initial version could not be saved',
          );
        }

        return  data;
      },
    );
  }
}
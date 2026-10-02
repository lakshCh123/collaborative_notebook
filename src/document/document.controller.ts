import {
  Controller,
  Post,
  Put,
  Body,
  Get,
  Param,
  ParseUUIDPipe,
  Headers,
  BadRequestException,
} from '@nestjs/common';

import { isUUID } from 'class-validator';

import { DocumentCreateService } from './docomument.create.service.js';
import { DocumentMergeService } from './document.merge.service.js';
import { DocumentHistoryService } from './document.getDocumentVersions.service.js';

import { CreateDocumentDto } from '../dto/create_document.dto.js';
import { UpdateDocumentDto } from '../dto/update_document.dto.js';

@Controller('documents')
export class DocumentController {
  constructor(
    private readonly documentCreateService: DocumentCreateService,
    private readonly documentMergeService: DocumentMergeService,
    private readonly documentHistoryService: DocumentHistoryService,
  ) {}

  private validateRequestId(requestId: string): void {
    if (!requestId || !isUUID(requestId)) {
      throw new BadRequestException(
        'A valid UUID is required in the idempotency-key header',
      );
    }
  }

  @Post()
  async create(
    @Body() dto: CreateDocumentDto,
    @Headers('idempotency-key') requestId: string,
  ) {
    this.validateRequestId(requestId);

    return this.documentCreateService.create(dto, requestId);
  }

  @Put()
  async merge(
    @Body() dto: UpdateDocumentDto,
    @Headers('idempotency-key') requestId: string,
  ) {
    this.validateRequestId(requestId);

    return this.documentMergeService.merge(dto, requestId);
  }

  @Get(':documentId/versions')
  async getDocumentVersions(
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Headers('idempotency-key') requestId: string,
  ) {
    this.validateRequestId(requestId);

    return this.documentHistoryService.getDocumentVersions(
      documentId,
      requestId,
    );
  }
}
import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyService } from './idempotency.service.js';

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IdempotencyService],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

import { PartialType } from '@nestjs/swagger';
import { CreateCategoryDto } from './create-category.dto';

/**
 * Every field optional. `code` stays editable but is still checked for
 * collisions within the tenant.
 */
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

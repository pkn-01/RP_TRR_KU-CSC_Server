import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles('ADMIN', 'IT')
  async getAllUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('roles') roles?: string,
  ) {
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (pageNum < 1 || limitNum < 1) {
      throw new BadRequestException('Page and limit must be greater than 0');
    }

    return this.usersService.getAllUsers(pageNum, limitNum, roles);
  }

  @Get('it-staff')
  @Roles('ADMIN', 'IT')
  async getITStaff() {
    return this.usersService.getITStaff();
  }

  @Get('search')
  @Roles('ADMIN', 'IT')
  async searchUsers(@Query('q') query: string) {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Query parameter is required');
    }
    return this.usersService.searchUsers(query.trim());
  }

  @Post()
  @Roles('ADMIN', 'IT')
  async createUser(@Body() data: any) {
    if (!data.name || !data.email || !data.password) {
      throw new BadRequestException('Name, email, and password are required');
    }
    return this.usersService.createUser(data);
  }

  @Get(':id')
  @Roles('ADMIN', 'IT')
  async getUserById(@Param('id') id: string) {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      throw new BadRequestException('Invalid user ID');
    }
    return this.usersService.getUserById(userId);
  }

  @Put(':id')
  @Roles('ADMIN', 'IT')
  async updateUser(@Param('id') id: string, @Body() data: any) {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      throw new BadRequestException('Invalid user ID');
    }
    return this.usersService.updateUser(userId, data);
  }

  @Post(':id/change-password')
  @Roles('ADMIN', 'IT')
  async changePassword(
    @Param('id') id: string,
    @Body() body: { newPassword: string },
  ) {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      throw new BadRequestException('Invalid user ID');
    }
    if (!body.newPassword || body.newPassword.trim().length === 0) {
      throw new BadRequestException('New password is required');
    }
    return this.usersService.changePassword(userId, body.newPassword);
  }

  @Delete(':id')
  @Roles('ADMIN', 'IT')
  async deleteUser(@Param('id') id: string) {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      throw new BadRequestException('Invalid user ID');
    }
    return this.usersService.deleteUser(userId);
  }
}

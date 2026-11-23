import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { PrismaService } from '../prisma/prisma.service';
import { slugify } from '../common/utils/slugify';
import { FindVendorsQueryDto } from './dto/find-vendors-query.dto';
import { paginate } from '../common/dto/paginated';


@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma:PrismaService
  ){}
  async create(ownerId:string,createVendorDto: CreateVendorDto) {

    const slug = slugify(createVendorDto.slug ?? createVendorDto.name);
    return await this.prisma.$transaction(async (tx)=>{
      const vendor = await tx.vendor.create({
        data:{
          name:createVendorDto.name,
          description:createVendorDto.description,
          slug,
          ownerId,
        },
      });
      await tx.user.update({
        where:{id:ownerId},
        data:{isVendor:true},
      })
      return vendor;
    })
    
  }

  async findAll(query:FindVendorsQueryDto) {
    const { page, limit, sortBy, order } = query;

    const where = {isApproved:true};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({
        where,
        orderBy:{[sortBy]:order},
        skip:(page-1)*limit,
        take:limit,
      }),
      this.prisma.vendor.count({where}),
    ]);

    return paginate (data, total, page,limit);
  }

  async findOne(id: string) {
    const vendor = await this.prisma.vendor.findUnique({where:{id}});
    if(!vendor) throw new NotFoundException(`Vendor with ID ${id} not found`)
    return vendor;

  }

  findPending(){
    return this.prisma.vendor.findMany({
      where:{isApproved:false},
      orderBy:{createdAt:'asc'},
      include:{owner:{select:{id:true, name:true, email:true}}},
    });
  }

  async approve(id:string){
    const vendor = await this.findOne(id);
    if(vendor.isApproved) return vendor;

    return this.prisma.vendor.update({
      where:{id},
      data:{isApproved:true, approvedAt:new Date()},
    });
  }

  async revokeApproval(id:string){
    await this.findOne(id);
    return this.prisma.vendor.update({
      where:{id},
      data:{isApproved:false, approvedAt:null},
    });
  }

  async update(id: string, updateVendorDto: UpdateVendorDto) {
    await this.findOne(id);
    const {slug, ...rest} = updateVendorDto;
    return await this.prisma.vendor.update({
      where:{id},
      data:{
        ...rest,
        ...(slug ? {slug: slugify(slug)}:{}), //slug
      }
    })
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.vendor.delete({where:{id}});
  }
}

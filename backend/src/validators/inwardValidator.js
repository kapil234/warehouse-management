import { z } from 'zod';

export const INWARD_TYPES = [
  'Purchase - New Stock',
  'Purchase - Service Stock',
  'Return of Purchase',
  'Service Stock from Customer',
];

const grnItemSchema = z.object({
  category: z.enum(['Inverters', 'Panels', 'Cables']),
  companyName: z.string().trim().min(1, 'Item company is required'),
  sku: z.string().min(1, 'SKU / model is required'),
  quantity: z.number().int().positive('Quantity must be greater than 0'),
  uom: z.enum(['Pcs', 'Meters', 'Bundles']),
});

const documentNumberSchema = z.object({
  type: z.string().min(1),
  number: z.string().min(1),
});

export const createGrnSchema = z.object({
  warehouseId: z.string().min(1),
  companyName: z.string().min(1, 'Company name is required'),
  inwardDateTime: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid inward date/time'),
  inwardType: z.enum(INWARD_TYPES),
  supplierName: z.string().min(1, 'Supplier / customer name is required'),
  refDocType: z.enum(['Invoice', 'Delivery Challan', 'Return Note']),
  refDocNumber: z.string().optional(),
  refDocDate: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid inward date/time'),
  ewayBillNumber: z.string().optional(),
  otherDocumentNumbers: z.array(documentNumberSchema).optional().default([]),
  remarks: z.string().optional(),
  items: z.array(grnItemSchema).min(1, 'At least one item is required'),
  documents: z.array(z.any()).optional().default([]),
});

import React from 'react';
import { ChevronDown } from 'lucide-react';

interface ColumnMapperProps {
  header: string;
  value: string;
  onChange: (newValue: string) => void;
  dataType: string;
}

export const ColumnMapper: React.FC<ColumnMapperProps> = ({
  header,
  value,
  onChange,
  dataType
}) => {
  // Option fields based on dataType
  const getFieldsForType = (type: string) => {
    const common = [
      { value: 'name', label: 'Medicine Name' },
      { value: 'batch_no', label: 'Batch No' },
      { value: 'expiry_date', label: 'Expiry Date' },
      { value: 'mrp', label: 'MRP (₹)' },
    ];

    switch (type) {
      case 'inventory':
        return [
          { label: 'Common Fields', fields: common },
          {
            label: 'Inventory Fields',
            fields: [
              { value: 'quantity', label: 'Stock (Qty)' },
              { value: 'loose_qty', label: 'Loose Qty' },
              { value: 'packaging', label: 'Packaging' },
              { value: 'cost_price', label: 'Rate / Cost Price (₹)' },
              { value: 'rack_location', label: 'Rack Location' },
              { value: 'hsn_code', label: 'HSN Code' },
              { value: 'category', label: 'Category' },
              { value: 'cgst', label: 'CGST %' },
              { value: 'sgst', label: 'SGST %' }
            ]
          }
        ];
      case 'purchases':
        return [
          { label: 'Common Fields', fields: common },
          {
            label: 'Purchase Fields',
            fields: [
              { value: 'invoice_no', label: 'Invoice No' },
              { value: 'date', label: 'Purchase Date' },
              { value: 'distributor_name', label: 'Distributor Name' },
              { value: 'quantity', label: 'Quantity Purchased' },
              { value: 'cost_price', label: 'Cost Price (₹)' },
              { value: 'total_amount', label: 'Total Bill Amount (₹)' },
              { value: 'discount', label: 'Discount %' }
            ]
          }
        ];
      case 'sales':
        return [
          { label: 'Common Fields', fields: common },
          {
            label: 'Sales Fields',
            fields: [
              { value: 'invoice_no', label: 'Bill / Invoice No' },
              { value: 'date', label: 'Sale Date' },
              { value: 'patient_name', label: 'Patient / Customer Name' },
              { value: 'doctor_name', label: 'Doctor Name' },
              { value: 'quantity', label: 'Quantity Sold' },
              { value: 'total_amount', label: 'Total Amount Paid (₹)' }
            ]
          }
        ];
      case 'returns':
        return [
          { label: 'Common Fields', fields: common },
          {
            label: 'Return Fields',
            fields: [
              { value: 'return_no', label: 'Return / Credit Note No' },
              { value: 'date', label: 'Return Date' },
              { value: 'distributor_name', label: 'Distributor Name' },
              { value: 'quantity', label: 'Return Quantity' },
              { value: 'total_amount', label: 'Refund Amount (₹)' }
            ]
          }
        ];
      default:
        return [
          { label: 'Common Fields', fields: common }
        ];
    }
  };

  const groups = getFieldsForType(dataType);

  return (
    <div className="relative w-full">
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-3 pr-8 py-1.5 rounded-lg border border-glass-border bg-bg3/40 text-text text-sm hover:border-border focus:border-sky focus:outline-none appearance-none cursor-pointer"
      >
        <option value="">-- Ignore Column --</option>
        {groups.map((group, idx) => (
          <optgroup key={idx} label={group.label} className="bg-bg text-text">
            {group.fields.map((field) => (
              <option key={field.value} value={field.value} className="bg-bg text-text">
                {field.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-muted">
        <ChevronDown size={16} />
      </div>
    </div>
  );
};

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { FileText } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  body: string;
  category: string | null;
}

interface TemplateSelectorProps {
  onSelect: (body: string) => void;
}

export const TemplateSelector = ({ onSelect }: TemplateSelectorProps) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fetchTemplates = async () => {
      const { data } = await supabase
        .from('templates')
        .select('*')
        .order('usage_count', { ascending: false });

      if (data) {
        setTemplates(data);
      }
    };

    fetchTemplates();
  }, []);

  const handleSelect = async (template: Template) => {
    onSelect(template.body);
    setOpen(false);

    // Update usage count
    await supabase
      .from('templates')
      .update({ usage_count: template.usage_count + 1 })
      .eq('id', template.id);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="h-4 w-4 mr-2" />
          Templates
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search templates..." />
          <CommandList>
            <CommandEmpty>No templates found.</CommandEmpty>
            <CommandGroup>
              {templates.map((template) => (
                <CommandItem
                  key={template.id}
                  onSelect={() => handleSelect(template)}
                  className="cursor-pointer"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{template.name}</span>
                    {template.category && (
                      <span className="text-xs text-muted-foreground">{template.category}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

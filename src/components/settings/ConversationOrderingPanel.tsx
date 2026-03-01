import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { GripVertical, Save, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

interface SortRule {
  id: string;
  field: string;
  direction: 'asc' | 'desc';
  label: string;
  enabled: boolean;
}

const defaultSortRules: SortRule[] = [
  { id: '1', field: 'sla_due_at', direction: 'asc', label: 'SLA Due Date', enabled: true },
  { id: '2', field: 'priority', direction: 'desc', label: 'Priority', enabled: true },
  { id: '3', field: 'created_at', direction: 'desc', label: 'Created Date', enabled: true },
  { id: '4', field: 'updated_at', direction: 'desc', label: 'Last Updated', enabled: false },
  { id: '5', field: 'message_count', direction: 'desc', label: 'Message Count', enabled: false }
];

export const ConversationOrderingPanel = () => {
  const { toast } = useToast();
  const [sortRules, setSortRules] = useState<SortRule[]>(defaultSortRules);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [defaultSort, setDefaultSort] = useState<string>('sla_urgent');

  useEffect(() => {
    // Load saved preferences
    const saved = localStorage.getItem('conversation-ordering-rules');
    if (saved) {
      try {
        setSortRules(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved rules', e);
      }
    }

    const savedDefault = localStorage.getItem('conversation-sort');
    if (savedDefault) {
      setDefaultSort(savedDefault);
    }
  }, []);

  const handleDragStart = (id: string) => {
    setDraggedItem(id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggedItem === null || draggedItem === id) return;

    const newRules = [...sortRules];
    const draggedIndex = newRules.findIndex(r => r.id === draggedItem);
    const targetIndex = newRules.findIndex(r => r.id === id);

    const [removed] = newRules.splice(draggedIndex, 1);
    newRules.splice(targetIndex, 0, removed);

    setSortRules(newRules);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  const toggleRule = (id: string) => {
    setSortRules(prev => prev.map(rule => 
      rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
    ));
  };

  const updateDirection = (id: string, direction: 'asc' | 'desc') => {
    setSortRules(prev => prev.map(rule => 
      rule.id === id ? { ...rule, direction } : rule
    ));
  };

  const saveRules = () => {
    localStorage.setItem('conversation-ordering-rules', JSON.stringify(sortRules));
    localStorage.setItem('conversation-sort', defaultSort);
    
    toast({
      title: 'Ordering Rules Saved',
      description: 'Your conversation ordering preferences have been updated.'
    });
  };

  const resetToDefaults = () => {
    setSortRules(defaultSortRules);
    setDefaultSort('sla_urgent');
    localStorage.removeItem('conversation-ordering-rules');
    localStorage.setItem('conversation-sort', 'sla_urgent');
    
    toast({
      title: 'Reset to Defaults',
      description: 'Ordering rules have been reset to default settings.'
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Conversation Ordering</CardTitle>
          <CardDescription>
            Customize how conversations are sorted and displayed in your inbox
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Default Sort Preset */}
          <div className="space-y-2">
            <Label htmlFor="default-sort">Default Sort Preset</Label>
            <Select value={defaultSort} onValueChange={setDefaultSort}>
              <SelectTrigger id="default-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sla_urgent">SLA Urgent First</SelectItem>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="priority_high">High Priority First</SelectItem>
                <SelectItem value="priority_low">Low Priority First</SelectItem>
                <SelectItem value="custom">Custom Rules (below)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Quick presets for common sorting needs
            </p>
          </div>

          {/* Custom Sort Rules */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Custom Sort Rules</Label>
              <Badge variant="outline" className="text-xs">
                Drag to reorder
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Define custom sorting by dragging rules into priority order. Higher rules take precedence.
            </p>

            <div className="space-y-2">
              {sortRules.map((rule, index) => (
                <Card
                  key={rule.id}
                  draggable
                  onDragStart={() => handleDragStart(rule.id)}
                  onDragOver={(e) => handleDragOver(e, rule.id)}
                  onDragEnd={handleDragEnd}
                  className={`border-border/50 transition-all ${
                    draggedItem === rule.id ? 'opacity-50' : ''
                  } ${rule.enabled ? 'bg-card' : 'bg-muted/30'}`}
                >
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab active:cursor-grabbing" />
                      
                      <Badge variant="secondary" className="w-8 h-8 rounded-full flex items-center justify-center p-0">
                        {index + 1}
                      </Badge>

                      <div className="flex-1 space-y-1">
                        <p className="font-medium text-sm">{rule.label}</p>
                        <code className="text-xs text-muted-foreground">{rule.field}</code>
                      </div>

                      <Select 
                        value={rule.direction} 
                        onValueChange={(val) => updateDirection(rule.id, val as 'asc' | 'desc')}
                        disabled={!rule.enabled}
                      >
                        <SelectTrigger className="w-32 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="asc">↑ Ascending</SelectItem>
                          <SelectItem value="desc">↓ Descending</SelectItem>
                        </SelectContent>
                      </Select>

                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={() => toggleRule(rule.id)}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t">
            <Button onClick={saveRules} className="flex-1">
              <Save className="h-4 w-4 mr-2" />
              Save Ordering Rules
            </Button>
            <Button onClick={resetToDefaults} variant="outline">
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to Defaults
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            How Custom Ordering Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li>Rules are applied in order from top to bottom</li>
            <li>Higher priority rules override lower ones</li>
            <li>Disabled rules are skipped</li>
            <li>Ascending sorts from low to high (A-Z, 0-9, oldest-newest)</li>
            <li>Descending sorts from high to low (Z-A, 9-0, newest-oldest)</li>
            <li>Changes apply immediately after saving</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

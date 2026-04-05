import { useState, useMemo, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, Loader2, X, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { isPreviewModeEnabled } from '@/lib/previewMode';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface BusinessContextStepProps {
  workspaceId: string;
  value: {
    companyName: string;
    businessType: string;
    isHiring: boolean;
    receivesInvoices: boolean;
    emailDomain: string;
    websiteUrl: string;
    serviceArea: string;
  };
  onChange: (value: any) => void;
  onNext: () => void;
  onBack: () => void;
}

interface PlacePrediction {
  description: string;
  place_id: string;
  original?: string;
}

interface ServiceArea {
  name: string;
  radius?: number; // in miles
}

const DEFAULT_SERVICE_RADIUS = 20;
const PREVIEW_LOCATION_SUGGESTIONS = [
  'Luton',
  'Dunstable',
  'Harpenden',
  'St Albans',
  'Milton Keynes',
  'Bedford',
  'Hemel Hempstead',
  'Watford',
  'Stevenage',
  'Leighton Buzzard',
  'Aylesbury',
  'Hitchin',
  'London',
];

const BUSINESS_TYPES = [
  // Cleaning Services
  { value: 'window_cleaning', label: 'Window Cleaning' },
  { value: 'carpet_cleaning', label: 'Carpet Cleaning' },
  { value: 'pressure_washing', label: 'Pressure Washing' },
  { value: 'general_cleaning', label: 'General Cleaning' },
  { value: 'domestic_cleaning', label: 'Domestic Cleaning' },
  { value: 'commercial_cleaning', label: 'Commercial Cleaning' },
  { value: 'oven_cleaning', label: 'Oven Cleaning' },
  { value: 'gutter_cleaning', label: 'Gutter Cleaning' },
  { value: 'end_of_tenancy', label: 'End of Tenancy Cleaning' },
  { value: 'upholstery_cleaning', label: 'Upholstery Cleaning' },
  // Building & Construction
  { value: 'builder', label: 'Builder' },
  { value: 'bricklayer', label: 'Bricklayer' },
  { value: 'carpenter', label: 'Carpenter' },
  { value: 'carpentry', label: 'Carpentry' },
  { value: 'joiner', label: 'Joiner' },
  { value: 'plasterer', label: 'Plasterer' },
  { value: 'tiler', label: 'Tiler' },
  { value: 'flooring', label: 'Flooring' },
  { value: 'roofer', label: 'Roofer' },
  { value: 'scaffolding', label: 'Scaffolding' },
  { value: 'demolition', label: 'Demolition' },
  { value: 'groundworks', label: 'Groundworks' },
  { value: 'driveway', label: 'Driveway Contractor' },
  { value: 'fencing', label: 'Fencing' },
  { value: 'decking', label: 'Decking' },
  // Trades
  { value: 'plumber', label: 'Plumber' },
  { value: 'electrician', label: 'Electrician' },
  { value: 'gas_engineer', label: 'Gas Engineer' },
  { value: 'heating_engineer', label: 'Heating Engineer' },
  { value: 'boiler_engineer', label: 'Boiler Engineer' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'air_conditioning', label: 'Air Conditioning' },
  { value: 'locksmith', label: 'Locksmith' },
  { value: 'glazier', label: 'Glazier' },
  { value: 'welder', label: 'Welder' },
  { value: 'blacksmith', label: 'Blacksmith' },
  // Decorating
  { value: 'painter_decorator', label: 'Painter & Decorator' },
  { value: 'interior_designer', label: 'Interior Designer' },
  { value: 'kitchen_fitter', label: 'Kitchen Fitter' },
  { value: 'bathroom_fitter', label: 'Bathroom Fitter' },
  { value: 'curtains_blinds', label: 'Curtains & Blinds' },
  // Outdoor & Garden
  { value: 'landscaping', label: 'Landscaping' },
  { value: 'gardener', label: 'Gardener' },
  { value: 'lawn_care', label: 'Lawn Care' },
  { value: 'tree_surgeon', label: 'Tree Surgeon' },
  { value: 'arborist', label: 'Arborist' },
  { value: 'garden_maintenance', label: 'Garden Maintenance' },
  { value: 'pond_specialist', label: 'Pond Specialist' },
  { value: 'irrigation', label: 'Irrigation' },
  // Automotive
  { value: 'mobile_mechanic', label: 'Mobile Mechanic' },
  { value: 'auto_electrician', label: 'Auto Electrician' },
  { value: 'car_valeting', label: 'Car Valeting' },
  { value: 'mobile_tyres', label: 'Mobile Tyres' },
  { value: 'windscreen_repair', label: 'Windscreen Repair' },
  { value: 'breakdown_recovery', label: 'Breakdown Recovery' },
  { value: 'mot_garage', label: 'MOT Garage' },
  { value: 'bodyshop', label: 'Bodyshop' },
  // Pet Services
  { value: 'dog_groomer', label: 'Dog Groomer' },
  { value: 'pet_groomer', label: 'Pet Groomer' },
  { value: 'dog_walker', label: 'Dog Walker' },
  { value: 'pet_sitter', label: 'Pet Sitter' },
  { value: 'dog_trainer', label: 'Dog Trainer' },
  { value: 'pet_boarding', label: 'Pet Boarding' },
  { value: 'mobile_vet', label: 'Mobile Vet' },
  // Home Services
  { value: 'handyman', label: 'Handyman' },
  { value: 'property_maintenance', label: 'Property Maintenance' },
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'removals', label: 'Removals' },
  { value: 'man_and_van', label: 'Man & Van' },
  { value: 'storage', label: 'Storage' },
  { value: 'house_clearance', label: 'House Clearance' },
  { value: 'skip_hire', label: 'Skip Hire' },
  { value: 'waste_removal', label: 'Waste Removal' },
  { value: 'chimney_sweep', label: 'Chimney Sweep' },
  { value: 'aerial_satellite', label: 'Aerial & Satellite' },
  { value: 'security_systems', label: 'Security Systems' },
  { value: 'cctv_installation', label: 'CCTV Installation' },
  // Health & Beauty
  { value: 'hairdresser', label: 'Hairdresser' },
  { value: 'barber', label: 'Barber' },
  { value: 'beauty_therapist', label: 'Beauty Therapist' },
  { value: 'nail_technician', label: 'Nail Technician' },
  { value: 'massage_therapist', label: 'Massage Therapist' },
  { value: 'personal_trainer', label: 'Personal Trainer' },
  { value: 'yoga_instructor', label: 'Yoga Instructor' },
  { value: 'physiotherapist', label: 'Physiotherapist' },
  { value: 'chiropractor', label: 'Chiropractor' },
  { value: 'osteopath', label: 'Osteopath' },
  { value: 'acupuncturist', label: 'Acupuncturist' },
  { value: 'nutritionist', label: 'Nutritionist' },
  // Events & Entertainment
  { value: 'photographer', label: 'Photographer' },
  { value: 'videographer', label: 'Videographer' },
  { value: 'dj', label: 'DJ' },
  { value: 'musician', label: 'Musician' },
  { value: 'band', label: 'Band' },
  { value: 'entertainer', label: 'Entertainer' },
  { value: 'magician', label: 'Magician' },
  { value: 'caterer', label: 'Caterer' },
  { value: 'event_planner', label: 'Event Planner' },
  { value: 'wedding_planner', label: 'Wedding Planner' },
  { value: 'florist', label: 'Florist' },
  { value: 'cake_maker', label: 'Cake Maker' },
  { value: 'marquee_hire', label: 'Marquee Hire' },
  // Professional Services
  { value: 'accountant', label: 'Accountant' },
  { value: 'bookkeeper', label: 'Bookkeeper' },
  { value: 'solicitor', label: 'Solicitor' },
  { value: 'estate_agent', label: 'Estate Agent' },
  { value: 'letting_agent', label: 'Letting Agent' },
  { value: 'surveyor', label: 'Surveyor' },
  { value: 'architect', label: 'Architect' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'coach', label: 'Coach' },
  { value: 'tutor', label: 'Tutor' },
  { value: 'translator', label: 'Translator' },
  { value: 'driving_instructor', label: 'Driving Instructor' },
  // IT & Tech
  { value: 'it_support', label: 'IT Support' },
  { value: 'computer_repair', label: 'Computer Repair' },
  { value: 'web_developer', label: 'Web Developer' },
  { value: 'app_developer', label: 'App Developer' },
  { value: 'graphic_designer', label: 'Graphic Designer' },
  { value: 'seo_marketing', label: 'SEO & Marketing' },
  { value: 'social_media', label: 'Social Media Manager' },
  // Other
  { value: 'tailor', label: 'Tailor' },
  { value: 'seamstress', label: 'Seamstress' },
  { value: 'upholsterer', label: 'Upholsterer' },
  { value: 'furniture_restoration', label: 'Furniture Restoration' },
  { value: 'appliance_repair', label: 'Appliance Repair' },
  { value: 'shoe_repair', label: 'Shoe Repair' },
  { value: 'dry_cleaner', label: 'Dry Cleaner' },
  { value: 'laundry_service', label: 'Laundry Service' },
  { value: 'delivery_service', label: 'Delivery Service' },
  { value: 'courier', label: 'Courier' },
  { value: 'taxi', label: 'Taxi' },
  { value: 'private_hire', label: 'Private Hire' },
  { value: 'childminder', label: 'Childminder' },
  { value: 'nanny', label: 'Nanny' },
  { value: 'care_worker', label: 'Care Worker' },
  { value: 'cleaner', label: 'Cleaner' },
  { value: 'ironing_service', label: 'Ironing Service' },
  { value: 'professional_services', label: 'Professional Services' },
  { value: 'other', label: 'Other' },
];

export function BusinessContextStep({
  workspaceId,
  value,
  onChange,
  onNext,
  onBack,
}: BusinessContextStepProps) {
  const isPreviewMode = isPreviewModeEnabled();
  const [isSaving, setIsSaving] = useState(false);
  const [businessTypeSearch, setBusinessTypeSearch] = useState('');
  const [serviceAreaSearch, setServiceAreaSearch] = useState('');
  const [businessTypeFocused, setBusinessTypeFocused] = useState(false);
  const [serviceAreaFocused, setServiceAreaFocused] = useState(false);
  const [placePredictions, setPlacePredictions] = useState<PlacePrediction[]>([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(false);
  const [newAreaRadius, setNewAreaRadius] = useState<string>(DEFAULT_SERVICE_RADIUS.toString());
  const [placesError, setPlacesError] = useState<string | null>(null);

  // Parse service areas from pipe-separated string (supports radius like "Luton (20 miles)")
  const selectedAreas = useMemo((): ServiceArea[] => {
    if (!value.serviceArea) return [];
    // Support both old comma format and new pipe format
    const raw = value.serviceArea.includes(' | ')
      ? value.serviceArea
          .split(' | ')
          .map((s) => s.trim())
          .filter(Boolean)
      : value.serviceArea
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    return raw.map((area) => {
      // Parse radius if present: "Luton (20 miles)"
      const radiusMatch = area.match(/^(.+?)\s*\((\d+)\s*miles?\)$/i);
      if (radiusMatch) {
        return { name: radiusMatch[1].trim(), radius: parseInt(radiusMatch[2], 10) };
      }
      return { name: area, radius: undefined };
    });
  }, [value.serviceArea]);

  useEffect(() => {
    const firstRadius = selectedAreas[0]?.radius;
    if (firstRadius) {
      setNewAreaRadius(firstRadius.toString());
    }
  }, [selectedAreas]);

  // Parse business types from comma-separated string
  const selectedBusinessTypes = useMemo(() => {
    if (!value.businessType) return [];
    return value.businessType
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [value.businessType]);

  // Filter business types based on search with fuzzy matching - only show when typing
  const filteredBusinessTypes = useMemo(() => {
    // Don't show anything if no search input
    if (!businessTypeSearch || businessTypeSearch.trim().length < 1) return [];

    const search = businessTypeSearch.toLowerCase().trim();

    // Score and filter matches
    const scored = BUSINESS_TYPES.filter(
      (type) =>
        !selectedBusinessTypes.includes(type.value) && !selectedBusinessTypes.includes(type.label),
    )
      .map((type) => {
        const label = type.label.toLowerCase();
        const value = type.value.toLowerCase();
        let score = 0;

        // Exact match gets highest score
        if (label === search || value === search) {
          score = 100;
        }
        // Starts with search term
        else if (label.startsWith(search) || value.startsWith(search)) {
          score = 80;
        }
        // Word starts with search term (e.g., "plumb" matches "Plumber")
        else if (
          label.split(/[\s&]+/).some((word) => word.startsWith(search)) ||
          value.split('_').some((word) => word.startsWith(search))
        ) {
          score = 60;
        }
        // Contains search term
        else if (label.includes(search) || value.includes(search)) {
          score = 40;
        }

        return { type, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((item) => item.type);

    return scored;
  }, [businessTypeSearch, selectedBusinessTypes]);

  // Debounced Google Places search
  const searchPlaces = useCallback(
    async (input: string) => {
      if (!input || input.trim().length < 2) {
        setPlacePredictions([]);
        setPlacesError(null);
        return;
      }

      if (isPreviewMode) {
        const search = input.trim().toLowerCase();
        const areaNames = selectedAreas.map((a) => a.name.toLowerCase());
        const predictions = PREVIEW_LOCATION_SUGGESTIONS.filter((name) =>
          name.toLowerCase().includes(search),
        )
          .filter((name) => !areaNames.includes(name.toLowerCase()))
          .map((name) => ({
            description: name,
            place_id: `preview-${name.toLowerCase().replace(/\s+/g, '-')}`,
          }));

        setPlacePredictions(predictions);
        setPlacesError(null);
        return;
      }

      setIsLoadingPlaces(true);
      setPlacesError(null);
      try {
        const { data, error } = await supabase.functions.invoke('google-places-autocomplete', {
          body: { input: input.trim() },
        });

        if (error) {
          console.error('Places API error:', error);
          setPlacePredictions([]);
          setPlacesError(
            'Google location search is temporarily unavailable. You can still add the area manually.',
          );
          return;
        }

        // Filter out already selected areas
        const areaNames = selectedAreas.map((a) => a.name);
        const filtered = (data.predictions || []).filter(
          (p: PlacePrediction) => !areaNames.includes(p.description),
        );
        setPlacePredictions(filtered);
      } catch (err) {
        console.error('Error fetching places:', err);
        setPlacePredictions([]);
        setPlacesError(
          'Google location search is temporarily unavailable. You can still add the area manually.',
        );
      } finally {
        setIsLoadingPlaces(false);
      }
    },
    [isPreviewMode, selectedAreas],
  );

  // Debounce the search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (serviceAreaSearch) {
        searchPlaces(serviceAreaSearch);
      } else {
        setPlacePredictions([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [serviceAreaSearch, searchPlaces]);

  const handleAddBusinessType = (typeLabel: string) => {
    const trimmed = typeLabel.trim();
    if (trimmed && !selectedBusinessTypes.includes(trimmed)) {
      const newTypes = [...selectedBusinessTypes, trimmed];
      onChange({ ...value, businessType: newTypes.join(', ') });
    }
    setBusinessTypeSearch('');
  };

  const handleSelectBusinessType = (type: { value: string; label: string }) => {
    handleAddBusinessType(type.label);
  };

  const handleRemoveBusinessType = (typeLabel: string) => {
    const newTypes = selectedBusinessTypes.filter((t) => t !== typeLabel);
    onChange({ ...value, businessType: newTypes.join(', ') });
  };

  const handleBusinessTypeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && businessTypeSearch.trim()) {
      e.preventDefault();
      handleAddBusinessType(businessTypeSearch);
    }
  };

  const handleSelectLocation = (location: string, radius?: number) => {
    // The edge function already strips country suffix, but clean up just in case
    let cleanLocation = location.trim();
    const countryPattern =
      /, (UK|United Kingdom|USA|United States|Australia|Canada|Ireland|Germany|France|Italy|Spain|Netherlands|New Zealand|India|Poland|Czechia|South Korea|Malaysia|Belarus|England|Scotland|Wales|Northern Ireland)$/i;
    cleanLocation = cleanLocation.replace(countryPattern, '');

    const areaNames = selectedAreas.map((a) => a.name);
    if (cleanLocation && !areaNames.includes(cleanLocation)) {
      const resolvedRadius = radius ?? parseInt(newAreaRadius, 10);
      const newArea: ServiceArea = {
        name: cleanLocation,
        radius: Number.isFinite(resolvedRadius) ? resolvedRadius : DEFAULT_SERVICE_RADIUS,
      };
      const newAreas = [...selectedAreas, newArea];
      // Serialize with radius: "Luton (20 miles)" or just "Luton"
      const serialized = newAreas
        .map((a) => (a.radius ? `${a.name} (${a.radius} miles)` : a.name))
        .join(' | ');
      onChange({ ...value, serviceArea: serialized });
    }
    setServiceAreaSearch('');
    setPlacePredictions([]);
    setPlacesError(null);
  };

  const handleUpdateRadius = (areaName: string, radius: number | undefined) => {
    const newAreas = selectedAreas.map((a) => (a.name === areaName ? { ...a, radius } : a));
    const serialized = newAreas
      .map((a) => (a.radius ? `${a.name} (${a.radius} miles)` : a.name))
      .join(' | ');
    onChange({ ...value, serviceArea: serialized });
  };

  const handleLocationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && serviceAreaSearch.trim()) {
      e.preventDefault();
      handleSelectLocation(serviceAreaSearch);
    }
  };

  const handleRemoveLocation = (areaName: string) => {
    const newAreas = selectedAreas.filter((a) => a.name !== areaName);
    const serialized = newAreas
      .map((a) => (a.radius ? `${a.name} (${a.radius} miles)` : a.name))
      .join(' | ');
    onChange({ ...value, serviceArea: serialized });
  };

  const handleSave = async () => {
    if (!value.companyName || selectedBusinessTypes.length === 0) {
      toast.error('Please enter your company name and select at least one business type');
      return;
    }

    setIsSaving(true);
    try {
      const { data: existing } = await supabase
        .from('business_context')
        .select('id')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      const contextData = {
        workspace_id: workspaceId,
        company_name: value.companyName,
        business_type: value.businessType,
        email_domain: value.emailDomain || null,
        website_url: value.websiteUrl || null,
        service_area: value.serviceArea || null,
        is_hiring: value.isHiring,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        await supabase.from('business_context').update(contextData).eq('id', existing.id);
      } else {
        await supabase.from('business_context').insert(contextData);
      }

      await supabase.from('workspaces').update({ name: value.companyName }).eq('id', workspaceId);

      if (value.receivesInvoices) {
        const invoiceSenders = [
          'xero.com',
          'quickbooks.com',
          'sage.com',
          'freshbooks.com',
          'stripe.com',
          'paypal.com',
        ];
        for (const domain of invoiceSenders) {
          const { data: existingRule } = await supabase
            .from('sender_rules')
            .select('id')
            .eq('sender_pattern', `@${domain}`)
            .eq('workspace_id', workspaceId)
            .maybeSingle();

          if (!existingRule) {
            await supabase.from('sender_rules').insert({
              workspace_id: workspaceId,
              sender_pattern: `@${domain}`,
              default_classification: 'supplier_invoice',
              default_requires_reply: false,
              is_active: true,
            });
          }
        }
      }

      if (value.isHiring) {
        const jobPortals = [
          'indeed.com',
          'linkedin.com',
          'reed.co.uk',
          'totaljobs.com',
          'cv-library.co.uk',
          'glassdoor.com',
        ];
        for (const domain of jobPortals) {
          const { data: existingRule } = await supabase
            .from('sender_rules')
            .select('id')
            .eq('sender_pattern', `@${domain}`)
            .eq('workspace_id', workspaceId)
            .maybeSingle();

          if (!existingRule) {
            await supabase.from('sender_rules').insert({
              workspace_id: workspaceId,
              sender_pattern: `@${domain}`,
              default_classification: 'recruitment_hr',
              default_requires_reply: false,
              is_active: true,
            });
          }
        }
      }

      onNext();
    } catch (error) {
      console.error('Error saving business context:', error);
      toast.error('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Tell us about your business</h2>
        <p className="text-sm text-muted-foreground">
          This helps BizzyBee understand your business and answer customer questions
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Your company name *</Label>
          <Input
            placeholder="e.g., Sarah's Dog Grooming"
            value={value.companyName}
            onChange={(e) => onChange({ ...value, companyName: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Used to identify your business in emails</p>
        </div>

        <div className="space-y-2">
          <Label>What type of business is this? *</Label>
          {selectedBusinessTypes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedBusinessTypes.map((typeLabel) => (
                <Badge key={typeLabel} variant="secondary" className="gap-1 pr-1">
                  {typeLabel}
                  <button
                    type="button"
                    onClick={() => handleRemoveBusinessType(typeLabel)}
                    className="ml-1 hover:bg-muted rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="relative">
            <Input
              placeholder="Start typing your trade or business..."
              value={businessTypeSearch}
              onChange={(e) => setBusinessTypeSearch(e.target.value)}
              onKeyDown={handleBusinessTypeKeyDown}
              onFocus={() => setBusinessTypeFocused(true)}
              onBlur={() => setTimeout(() => setBusinessTypeFocused(false), 150)}
            />
            {businessTypeFocused &&
              (filteredBusinessTypes.length > 0 ||
                (businessTypeSearch.trim() &&
                  !filteredBusinessTypes.some(
                    (t) => t.label.toLowerCase() === businessTypeSearch.toLowerCase(),
                  ))) && (
                <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                  {businessTypeSearch.trim() &&
                    !filteredBusinessTypes.some(
                      (t) => t.label.toLowerCase() === businessTypeSearch.toLowerCase(),
                    ) && (
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground border-b"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleAddBusinessType(businessTypeSearch);
                        }}
                      >
                        Add "{businessTypeSearch.trim()}"
                      </button>
                    )}
                  {filteredBusinessTypes.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectBusinessType(type);
                      }}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              )}
          </div>
          <p className="text-xs text-muted-foreground">
            Type any business type and press Enter, or select from suggestions
          </p>
        </div>

        <div className="space-y-2">
          <Label>Your website URL (optional)</Label>
          <Input
            placeholder="e.g., https://sarahsdoggrooming.co.uk"
            value={value.websiteUrl || ''}
            onChange={(e) => onChange({ ...value, websiteUrl: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            We'll extract your prices, services, and policies automatically
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label>Primary service location &amp; radius (optional)</Label>
            {isPreviewMode && (
              <Badge variant="secondary" className="text-[10px] uppercase tracking-[0.08em]">
                Preview mode
              </Badge>
            )}
          </div>
          {selectedAreas.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedAreas.map((area) => (
                <div
                  key={area.name}
                  className="flex items-center gap-0 rounded-lg border border-border overflow-hidden bg-background"
                >
                  {/* Location name */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    <span className="text-sm font-medium">{area.name}</span>
                  </div>
                  {/* Radius selector - visually separated */}
                  <Select
                    value={area.radius?.toString() || 'exact'}
                    onValueChange={(val) =>
                      handleUpdateRadius(area.name, val === 'exact' ? undefined : parseInt(val, 10))
                    }
                  >
                    <SelectTrigger className="h-auto min-w-[80px] text-xs font-medium border-0 border-l border-border rounded-none bg-muted/50 px-2.5 py-1.5 hover:bg-muted transition-colors">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exact">Exact area</SelectItem>
                      <SelectItem value="5">+5 miles</SelectItem>
                      <SelectItem value="10">+10 miles</SelectItem>
                      <SelectItem value="15">+15 miles</SelectItem>
                      <SelectItem value="20">+20 miles</SelectItem>
                      <SelectItem value="30">+30 miles</SelectItem>
                      <SelectItem value="50">+50 miles</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => handleRemoveLocation(area.name)}
                    className="px-2 py-1.5 border-l border-border hover:bg-destructive/10 transition-colors"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                placeholder={
                  isPreviewMode ? 'Search for a town or city...' : 'Search with Google Places...'
                }
                value={serviceAreaSearch}
                onChange={(e) => setServiceAreaSearch(e.target.value)}
                onKeyDown={handleLocationKeyDown}
                onFocus={() => setServiceAreaFocused(true)}
                onBlur={() => setTimeout(() => setServiceAreaFocused(false), 200)}
              />
              {serviceAreaFocused &&
                (isLoadingPlaces ||
                  placePredictions.length > 0 ||
                  (serviceAreaSearch.trim().length >= 2 &&
                    !placePredictions.some(
                      (p) => p.description.toLowerCase() === serviceAreaSearch.toLowerCase(),
                    ))) && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                    {isLoadingPlaces ? (
                      <div className="flex items-center justify-center py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Searching...
                      </div>
                    ) : (
                      <>
                        {serviceAreaSearch.trim().length >= 2 &&
                          !placePredictions.some(
                            (p) => p.description.toLowerCase() === serviceAreaSearch.toLowerCase(),
                          ) && (
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground border-b"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectLocation(serviceAreaSearch);
                              }}
                            >
                              Add "{serviceAreaSearch.trim()}" with a {newAreaRadius}-mile radius
                            </button>
                          )}
                        {placePredictions.map((prediction) => (
                          <button
                            key={prediction.place_id}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSelectLocation(prediction.description);
                            }}
                          >
                            {prediction.description}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
            </div>
            <Select value={newAreaRadius} onValueChange={setNewAreaRadius}>
              <SelectTrigger className="w-[132px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 miles</SelectItem>
                <SelectItem value="10">10 miles</SelectItem>
                <SelectItem value="15">15 miles</SelectItem>
                <SelectItem value="20">20 miles</SelectItem>
                <SelectItem value="30">30 miles</SelectItem>
                <SelectItem value="40">40 miles</SelectItem>
                <SelectItem value="50">50 miles</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {isPreviewMode
              ? 'Preview mode uses local place suggestions. In the live app, this field searches Google Places.'
              : 'Choose the main town or city customers associate with you, then set how many miles around it you cover.'}
          </p>
          {placesError ? <p className="text-xs text-amber-600">{placesError}</p> : null}
        </div>

        <div className="space-y-2">
          <Label>Your business email domain</Label>
          <Input
            placeholder="e.g., sarahsdoggrooming.co.uk"
            value={value.emailDomain}
            onChange={(e) => onChange({ ...value, emailDomain: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Helps identify internal vs external emails
          </p>
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
          <div className="space-y-0.5">
            <Label>Are you currently hiring?</Label>
            <p className="text-xs text-muted-foreground">
              Helps us flag job applications separately
            </p>
          </div>
          <Switch
            checked={value.isHiring}
            onCheckedChange={(checked) => onChange({ ...value, isHiring: checked })}
          />
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
          <div className="space-y-0.5">
            <Label>Do you receive invoices by email?</Label>
            <p className="text-xs text-muted-foreground">
              Auto-sorts invoices from Xero, QuickBooks, etc.
            </p>
          </div>
          <Switch
            checked={value.receivesInvoices}
            onCheckedChange={(checked) => onChange({ ...value, receivesInvoices: checked })}
          />
        </div>
      </div>

      <div className="flex gap-3 pt-4">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          className="flex-1"
          onClick={handleSave}
          disabled={isSaving || !value.companyName || selectedBusinessTypes.length === 0}
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Continue
              <ChevronRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

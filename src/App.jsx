import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Umbrella, Tent, Waves, ChevronLeft, ChevronRight, Check, X,
  Plus, Minus, MapPin, Clock, CreditCard, ClipboardList,
  Sun, ShieldCheck, AlertCircle, Loader2, ArrowRight, CalendarX, Target, Wind,
  Settings2, RotateCcw, Refrigerator, Mail, MessageCircle, LogIn, LogOut, Search
} from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

/* ----------------------------- constants ----------------------------- */

const BEACHES = [
  { id: "tamarack", name: "Tamarack Beach", blurb: "Soft break, easy parking, the regulars' spot." },
  { id: "tower36", name: "Tower 36", blurb: "Wider sand, better for groups and gear." },
];

const INVENTORY = [
  { id: "tent", label: "Tent", unit: "tent", total: 3, price: 45, icon: "tent" },
  { id: "canopy", label: "Canopy", unit: "canopy", total: 1, price: 40, icon: "canopy" },
  { id: "umbrella", label: "Umbrella", unit: "umbrella", total: 6, price: 20, icon: "umbrella" },
  { id: "chair", label: "Beach chair", unit: "chair", total: 12, price: 12, icon: "chair" },
  { id: "tapestry", label: "Tapestry", unit: "tapestry", total: 4, price: 10, icon: "tapestry" },
  { id: "towel", label: "Towel", unit: "towel", total: 20, price: 5, icon: "towel" },
  { id: "kite", label: "Kite", unit: "kite", total: 3, price: 18, icon: "kite" },
  { id: "cooler", label: "Cooler full of ice", unit: "cooler", total: 4, price: 30, icon: "cooler" },
  { id: "cornhole", label: "Cornhole set", unit: "set", total: 3, price: 20, icon: "game" },
  { id: "laddergolf", label: "Ladder golf set", unit: "set", total: 3, price: 18, icon: "game" },
  { id: "frisbee", label: "Frisbee", unit: "frisbee", total: 3, price: 5, icon: "game" },
];

const PACKAGES = [
  {
    id: "family-day",
    name: "Family Day",
    desc: "Shade, seating, and a kite for the whole crew.",
    price: 130,
    fullPrice: 141,
    items: { tent: 1, chair: 4, towel: 4, kite: 1, tapestry: 1 },
  },
  {
    id: "crew-bash",
    name: "Crew Bash",
    desc: "Big canopy, full seating, cornhole, and a cooler full of ice for the crew.",
    price: 150,
    fullPrice: 202,
    items: { canopy: 1, chair: 6, towel: 6, cornhole: 1, tapestry: 1, cooler: 1 },
  },
];

const MAX_BOOKINGS_PER_DAY = 3;
const ORDER_MINIMUM = 100;
const CUTOFF_HOUR = 20; // 8pm
const STORAGE_KEY = "orders";

/* ----------------------------- utilities ----------------------------- */

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// Earliest bookable date given "must book by 8pm the day before"
function earliestBookableDate(now) {
  const todayCutoffPassed = now.getHours() >= CUTOFF_HOUR;
  return ymd(addDays(now, todayCutoffPassed ? 2 : 1));
}

function approxSunsetBreakdown() {
  // Simple static estimate (breakdown = 1hr before sunset). Kept simple/explicit for now.
  return "Setup 10:00 AM · Breakdown ~1 hr before sunset";
}

function mergeItemCounts(a, b) {
  const out = { ...a };
  Object.entries(b).forEach(([id, qty]) => {
    out[id] = (out[id] || 0) + qty;
  });
  return out;
}

// Beach chairs and towels are always booked in equal numbers.
const PAIRED_WITH = { chair: "towel" };

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const WEEKEND_SURCHARGE = 0.2; // 20% on Saturday & Sunday

function isWeekend(dateStr) {
  const day = new Date(dateStr + "T12:00:00").getDay(); // 0 = Sun, 6 = Sat
  return day === 0 || day === 6;
}

// Applies the weekend surcharge (rounded to whole dollars) to a base price for the given date.
function priceForDate(basePrice, dateStr) {
  if (!dateStr || !isWeekend(dateStr)) return basePrice;
  return Math.round(basePrice * (1 + WEEKEND_SURCHARGE));
}

function currency(n) {
  return `$${n.toFixed(2)}`;
}

/* ----------------------------- storage hooks ----------------------------- */

/* ----------------------------- storage (localStorage) ----------------------------- */

async function storageGet(key) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

async function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------- icon mapping ----------------------------- */

function ItemIcon({ icon, className }) {
  const map = {
    tent: Tent,
    canopy: Tent,
    umbrella: Umbrella,
    chair: Sun,
    tapestry: Waves,
    towel: Waves,
    kite: Wind,
    cooler: Refrigerator,
    game: Target,
  };
  const Cmp = map[icon] || Sun;
  return <Cmp className={className} />;
}

/* ----------------------------- main app ----------------------------- */

const CREW_PIN = "8647";
const PAR_STORAGE_KEY = "parOverrides";

export default function App() {
  const [view, setView] = useState("book"); // book | my-booking | crew | crew-inventory | crew-locked
  const [orders, setOrders] = useState(null);
  const [parOverrides, setParOverrides] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const [crewUnlocked, setCrewUnlocked] = useState(false);
  const [activeBookingId, setActiveBookingId] = useState(null); // which order to show in My Booking

  useEffect(() => {
    (async () => {
      const data = await storageGet(STORAGE_KEY);
      setOrders(data === null ? [] : Array.isArray(data) ? data : []);
    })();
    (async () => {
      const data = await storageGet(PAR_STORAGE_KEY);
      setParOverrides(data && typeof data === "object" ? data : {});
    })();
  }, []);

  const persistOrders = useCallback(async (next) => {
    setOrders(next);
    const ok = await storageSet(STORAGE_KEY, next);
    if (!ok) setStorageError(true);
  }, []);

  const addOrder = useCallback(async (order) => {
    const next = [...(orders || []), order];
    await persistOrders(next);
    setActiveBookingId(order.id);
    setView("my-booking");
  }, [orders, persistOrders]);

  const updateOrder = useCallback(async (orderId, patch) => {
    const next = (orders || []).map((o) => o.id === orderId ? { ...o, ...patch } : o);
    await persistOrders(next);
  }, [orders, persistOrders]);

  const persistParOverrides = useCallback(async (next) => {
    setParOverrides(next);
    const ok = await storageSet(PAR_STORAGE_KEY, next);
    if (!ok) setStorageError(true);
  }, []);

  const setItemPar = useCallback(async (itemId, value) => {
    const next = { ...(parOverrides || {}), [itemId]: value };
    await persistParOverrides(next);
  }, [parOverrides, persistParOverrides]);

  const resetItemPar = useCallback(async (itemId) => {
    const next = { ...(parOverrides || {}) };
    delete next[itemId];
    await persistParOverrides(next);
  }, [parOverrides, persistParOverrides]);

  function handleSetView(next) {
    if ((next === "crew" || next === "crew-inventory") && !crewUnlocked) {
      setView(next === "crew-inventory" ? "crew-inventory-locked" : "crew-locked");
    } else {
      setView(next);
    }
  }

  const dataLoading = orders === null || parOverrides === null;
  const activeOrder = orders?.find((o) => o.id === activeBookingId) ?? null;

  return (
    <div className="min-h-screen" style={{ background: "#EDE6D6", color: "#3A332B" }}>
      <style>{FONT_IMPORT}</style>
      <TopNav view={view.startsWith("crew-inventory") ? "crew-inventory" : view.startsWith("crew") ? "crew" : view} setView={handleSetView} />
      {storageError && (
        <div className="px-4 py-2 text-sm flex items-center gap-2" style={{ background: "#D96B4C", color: "#fff" }}>
          <AlertCircle size={16} /> Changes couldn't be saved this session.
        </div>
      )}
      {dataLoading ? (
        <div className="flex items-center justify-center py-24 text-[#3A332B]/60">
          <Loader2 className="animate-spin mr-2" size={18} /> Loading the shack ledger…
        </div>
      ) : view === "book" ? (
        <BookingFlow orders={orders} parOverrides={parOverrides} onConfirm={addOrder} />
      ) : view === "my-booking" ? (
        <MyBookingView
          order={activeOrder}
          orders={orders}
          onUpdateOrder={updateOrder}
          onSelectOrder={(id) => setActiveBookingId(id)}
          onNewBooking={() => setView("book")}
        />
      ) : view === "crew-locked" || view === "crew-inventory-locked" ? (
        <CrewPinGate
          onUnlock={() => {
            setCrewUnlocked(true);
            setView(view === "crew-inventory-locked" ? "crew-inventory" : "crew");
          }}
          onCancel={() => setView("book")}
        />
      ) : view === "crew-inventory" ? (
        <CrewInventoryView parOverrides={parOverrides} onSetPar={setItemPar} onResetPar={resetItemPar} />
      ) : (
        <CrewView orders={orders} onUpdateOrder={updateOrder} />
      )}
    </div>
  );
}

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;500;600;700&display=swap');
.font-display { font-family: 'Archivo Black', sans-serif; letter-spacing: -0.02em; }
.font-body { font-family: 'Archivo', sans-serif; }
`;

/* ----------------------------- top nav ----------------------------- */

function TopNav({ view, setView }) {
  return (
    <div className="sticky top-0 z-30 font-body" style={{ background: "#1B3A4B" }}>
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves size={20} color="#EDE6D6" />
          <span className="font-display text-lg" style={{ color: "#EDE6D6" }}>BESTBEACHSETUP</span>
        </div>
      </div>
      <div className="flex px-4 gap-1">
        {[
          { id: "book", label: "Book" },
          { id: "my-booking", label: "My Booking" },
          { id: "crew", label: "Crew" },
          { id: "crew-inventory", label: "Inventory" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            className="flex-1 py-2.5 text-[11px] font-semibold rounded-t-lg transition-colors"
            style={{
              background: view === tab.id ? "#EDE6D6" : "transparent",
              color: view === tab.id ? "#1B3A4B" : "#EDE6D6cc",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- availability engine ----------------------------- */

// The current par for an item: a crew-set override if one exists, otherwise the default total.
function effectiveTotal(itemId, parOverrides) {
  const override = parOverrides?.[itemId];
  return typeof override === "number" ? override : (INVENTORY.find((i) => i.id === itemId)?.total ?? 0);
}

// Returns: { bookingsCount, remaining: {itemId: count} }
function dayAvailability(orders, dateStr, parOverrides) {
  const dayOrders = orders.filter((o) => o.date === dateStr);
  const used = {};
  INVENTORY.forEach((i) => (used[i.id] = 0));
  dayOrders.forEach((o) => {
    Object.entries(o.items).forEach(([id, qty]) => {
      used[id] = (used[id] || 0) + qty;
    });
  });
  const remaining = {};
  INVENTORY.forEach((i) => {
    remaining[i.id] = effectiveTotal(i.id, parOverrides) - (used[i.id] || 0);
  });
  return { bookingsCount: dayOrders.length, remaining };
}

function canFitPackage(remaining, pkgItems) {
  return Object.entries(pkgItems).every(([id, qty]) => (remaining[id] ?? 0) >= qty);
}

/* ----------------------------- booking flow ----------------------------- */

function BookingFlow({ orders, parOverrides, onConfirm }) {
  const [step, setStep] = useState(1); // 1 beach, 2 date, 3 gear, 4 waiver, 5 checkout, 6 done
  const [beach, setBeach] = useState(null);
  const [date, setDate] = useState(null);
  const [mode, setMode] = useState(null); // "package" | "items"
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [cart, setCart] = useState({}); // itemId -> qty
  const [waiver, setWaiver] = useState(null); // { name, agreedAt }
  const [lastOrder, setLastOrder] = useState(null);

  const now = useMemo(() => new Date(), []);
  const earliest = useMemo(() => earliestBookableDate(now), [now]);

  const dateOptions = useMemo(() => {
    const opts = [];
    for (let i = 0; i < 10; i++) {
      const d = ymd(addDays(new Date(earliest + "T12:00:00"), i));
      opts.push(d);
    }
    return opts;
  }, [earliest]);

  const availability = date ? dayAvailability(orders, date, parOverrides) : null;
  const dayFull = availability ? availability.bookingsCount >= MAX_BOOKINGS_PER_DAY : false;

  const addOnsTotal = useMemo(() => {
    return Object.entries(cart).reduce((sum, [id, qty]) => {
      const item = INVENTORY.find((i) => i.id === id);
      return sum + (item ? priceForDate(item.price, date) * qty : 0);
    }, 0);
  }, [cart, date]);

  const cartTotal = useMemo(() => {
    if (mode === "package" && selectedPackage) return priceForDate(selectedPackage.price, date) + addOnsTotal;
    if (mode === "items") return addOnsTotal;
    return 0;
  }, [mode, selectedPackage, addOnsTotal, date]);

  function resetCartState() {
    setMode(null);
    setSelectedPackage(null);
    setCart({});
    setWaiver(null);
  }

  function goToStep(n) {
    setStep(n);
  }

  function handleConfirmOrder(payment) {
    const items = mode === "package"
      ? mergeItemCounts(selectedPackage.items, cart)
      : cart;
    const order = {
      id: uid(),
      beachId: beach.id,
      beachName: beach.name,
      date,
      items,
      total: cartTotal,
      packageName: mode === "package" ? selectedPackage.name : null,
      addOns: mode === "package" ? cart : null,
      waiver,
      email: payment.email || null,
      payment,
      createdAt: new Date().toISOString(),
      status: "confirmed",
      checkinAt: null,
      checkoutAt: null,
      checkoutItems: null,
      messages: [],
    };
    onConfirm(order);
    setLastOrder(order);
    setStep(6);

    // Send receipt email if we have an email address
    if (payment.email) {
      fetch("/api/send-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: payment.email,
          beachName: beach.name,
          date,
          items,
          total: cartTotal,
          confirmationId: order.id,
          waiverName: waiver?.name || null,
          packageName: order.packageName,
        }),
      }).catch((err) => console.error("Receipt email failed:", err));
    }
  }

  function startOver() {
    setStep(1);
    setBeach(null);
    setDate(null);
    resetCartState();
    setLastOrder(null);
  }

  return (
    <div className="font-body max-w-md mx-auto pb-10">
      {step < 6 && <ProgressStrip step={step} />}

      {step === 1 && (
        <BeachStep
          beaches={BEACHES}
          selected={beach}
          onSelect={(b) => {
            setBeach(b);
            goToStep(2);
          }}
        />
      )}

      {step === 2 && beach && (
        <DateStep
          beach={beach}
          dateOptions={dateOptions}
          orders={orders}
          parOverrides={parOverrides}
          selected={date}
          onBack={() => goToStep(1)}
          onSelect={(d) => {
            setDate(d);
            resetCartState();
            goToStep(3);
          }}
        />
      )}

      {step === 3 && beach && date && (
        <GearStep
          beach={beach}
          date={date}
          availability={availability}
          parOverrides={parOverrides}
          mode={mode}
          setMode={setMode}
          selectedPackage={selectedPackage}
          onSelectPackage={(pkg) => {
            setSelectedPackage(pkg);
            setCart({}); // reset add-ons when package changes
          }}
          cart={cart}
          setCart={setCart}
          cartTotal={cartTotal}
          addOnsTotal={addOnsTotal}
          onBack={() => goToStep(2)}
          onContinue={() => goToStep(4)}
        />
      )}

      {step === 4 && (
        <WaiverStep
          beach={beach}
          date={date}
          waiver={waiver}
          onBack={() => goToStep(3)}
          onAgree={(signature) => {
            setWaiver(signature);
            goToStep(5);
          }}
        />
      )}

      {step === 5 && (
        <CheckoutStep
          beach={beach}
          date={date}
          mode={mode}
          selectedPackage={selectedPackage}
          cart={cart}
          total={cartTotal}
          onBack={() => goToStep(4)}
          onPay={handleConfirmOrder}
        />
      )}

      {step === 6 && lastOrder && (
        <ConfirmationStep order={lastOrder} onNewOrder={startOver} />
      )}
    </div>
  );
}

/* ----------------------------- progress strip (signature element) ----------------------------- */

function ProgressStrip({ step }) {
  const labels = ["Beach", "Day", "Gear", "Waiver", "Pay"];
  return (
    <div className="flex items-center px-4 pt-4 pb-2 gap-1">
      {labels.map((l, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <React.Fragment key={l}>
            <div className="flex flex-col items-center gap-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
                style={{
                  background: done ? "#7A9E8E" : active ? "#D96B4C" : "#1B3A4B22",
                  color: done || active ? "#fff" : "#3A332B66",
                }}
              >
                {done ? <Check size={14} /> : n}
              </div>
              <span className="text-[10px] font-semibold" style={{ color: active ? "#1B3A4B" : "#3A332B66" }}>
                {l}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div className="flex-1 h-[2px] mb-4" style={{ background: step > n ? "#7A9E8E" : "#1B3A4B22" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ----------------------------- step 1: beach ----------------------------- */

function BeachStep({ beaches, onSelect }) {
  return (
    <div className="px-4 pt-2">
      <h1 className="font-display text-2xl mb-1" style={{ color: "#1B3A4B" }}>Pick your beach</h1>
      <p className="text-sm mb-5" style={{ color: "#3A332B99" }}>We set up before you arrive and break it all down after.</p>
      <div className="flex flex-col gap-3">
        {beaches.map((b) => (
          <button
            key={b.id}
            onClick={() => onSelect(b)}
            className="text-left p-4 rounded-2xl border-2 transition-transform active:scale-[0.98]"
            style={{ borderColor: "#1B3A4B22", background: "#fff" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <MapPin size={16} color="#D96B4C" />
                  <span className="font-display text-base" style={{ color: "#1B3A4B" }}>{b.name}</span>
                </div>
                <p className="text-sm mt-1" style={{ color: "#3A332B99" }}>{b.blurb}</p>
              </div>
              <ArrowRight size={18} color="#1B3A4B66" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- step 2: date (tide strip) ----------------------------- */

function DateStep({ beach, dateOptions, orders, parOverrides, selected, onBack, onSelect }) {
  return (
    <div className="px-4 pt-2">
      <BackRow onBack={onBack} label={beach.name} />
      <h1 className="font-display text-2xl mb-1 mt-2" style={{ color: "#1B3A4B" }}>Pick your day</h1>
      <p className="text-sm mb-1" style={{ color: "#3A332B99" }}>
        Advance booking only — orders close 8:00 PM the day before.
      </p>
      <p className="text-sm mb-1" style={{ color: "#3A332B99" }}>
        Weekend pricing: Saturdays and Sundays run 20% higher.
      </p>
      <p className="text-sm mb-5 flex items-center gap-1.5" style={{ color: "#3A332B99" }}>
        <Clock size={14} /> {approxSunsetBreakdown()}
      </p>

      <div className="rounded-2xl p-3" style={{ background: "#1B3A4B" }}>
        <div className="text-[11px] font-semibold uppercase tracking-wide mb-3 px-1" style={{ color: "#EDE6D699" }}>
          Tide of bookings — next 10 days
        </div>
        <div className="flex flex-col gap-2">
          {dateOptions.map((d) => {
            const { bookingsCount } = dayAvailability(orders, d, parOverrides);
            const full = bookingsCount >= MAX_BOOKINGS_PER_DAY;
            const isSelected = selected === d;
            const slotsOpen = MAX_BOOKINGS_PER_DAY - bookingsCount;
            return (
              <button
                key={d}
                disabled={full}
                onClick={() => onSelect(d)}
                className="flex items-center justify-between px-3 py-3 rounded-xl transition-all"
                style={{
                  background: full ? "#0000001a" : isSelected ? "#D96B4C" : "#EDE6D6",
                  opacity: full ? 0.5 : 1,
                  cursor: full ? "not-allowed" : "pointer",
                }}
              >
                <span className="font-semibold text-sm flex items-center gap-1.5" style={{ color: full ? "#EDE6D699" : isSelected ? "#fff" : "#1B3A4B" }}>
                  {formatDateLabel(d)}
                  {isWeekend(d) && !full && (
                    <span
                      className="text-[9px] font-bold px-1 py-0.5 rounded"
                      style={{ background: isSelected ? "#ffffff33" : "#D96B4C22", color: isSelected ? "#fff" : "#D96B4C" }}
                    >
                      +20%
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {full ? (
                    <span className="text-xs font-bold flex items-center gap-1" style={{ color: "#EDE6D699" }}>
                      <CalendarX size={12} /> Full
                    </span>
                  ) : (
                    <TideDots total={MAX_BOOKINGS_PER_DAY} open={slotsOpen} highlight={isSelected} />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TideDots({ total, open, highlight }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: total }).map((_, i) => {
        const filled = i < total - open; // filled = booked
        return (
          <div
            key={i}
            className="w-2.5 h-2.5 rounded-full"
            style={{
              background: filled ? (highlight ? "#fff8" : "#1B3A4B55") : (highlight ? "#fff" : "#7A9E8E"),
            }}
          />
        );
      })}
    </div>
  );
}

function BackRow({ onBack, label }) {
  return (
    <button onClick={onBack} className="flex items-center gap-1 text-sm font-semibold" style={{ color: "#D96B4C" }}>
      <ChevronLeft size={16} /> {label}
    </button>
  );
}

/* ----------------------------- step 3: gear ----------------------------- */

function GearStep({ beach, date, availability, parOverrides, mode, setMode, selectedPackage, onSelectPackage, cart, setCart, cartTotal, addOnsTotal, onBack, onContinue }) {
  const remaining = availability.remaining;

  // Inventory still left after subtracting the chosen package (for add-ons), or full remaining in à la carte mode.
  const remainingForCart = useMemo(() => {
    if (mode !== "package" || !selectedPackage) return remaining;
    const out = { ...remaining };
    Object.entries(selectedPackage.items).forEach(([id, qty]) => {
      out[id] = (out[id] ?? 0) - qty;
    });
    return out;
  }, [mode, selectedPackage, remaining]);

  function setQty(id, qty) {
    let cap = Math.min(remainingForCart[id] ?? 0, effectiveTotal(id, parOverrides));

    // Chair/towel pairing only applies to add-ons on top of a package, not pure à la carte.
    const partner = mode === "package" ? PAIRED_WITH[id] : null;
    if (partner) {
      cap = Math.min(cap, remainingForCart[partner] ?? 0, effectiveTotal(partner, parOverrides));
    }

    const clamped = Math.max(0, Math.min(qty, cap));

    setCart((c) => {
      const next = { ...c, [id]: clamped };
      if (clamped === 0) delete next[id];

      if (partner) {
        if (clamped === 0) delete next[partner];
        else next[partner] = clamped;
      }
      return next;
    });
  }

  function switchMode(next) {
    setMode(next);
    setCart({});
  }

  const cartHasItems = mode === "package" ? !!selectedPackage : Object.keys(cart).length > 0;

  return (
    <div className="px-4 pt-2 pb-28">
      <BackRow onBack={onBack} label={formatDateLabel(date)} />
      <h1 className="font-display text-2xl mb-1 mt-2" style={{ color: "#1B3A4B" }}>Choose your gear</h1>
      <p className="text-sm mb-4" style={{ color: "#3A332B99" }}>
        {beach.name} · {formatDateLabel(date)} — shared inventory across both beaches.
      </p>

      {isWeekend(date) && (
        <div className="flex items-center gap-1.5 text-xs font-semibold mb-4 px-3 py-2 rounded-xl" style={{ background: "#D96B4C22", color: "#D96B4C" }}>
          <AlertCircle size={13} /> Weekend pricing — all items and packages are 20% higher on Saturdays and Sundays.
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <ModeButton label="Packages" active={mode === "package"} onClick={() => switchMode("package")} />
        <ModeButton label="Pick items" active={mode === "items"} onClick={() => switchMode("items")} />
      </div>

      {mode === "package" && (
        <div className="flex flex-col gap-3">
          {PACKAGES.map((pkg) => {
            const fits = canFitPackage(remaining, pkg.items);
            const isSelected = selectedPackage?.id === pkg.id;
            return (
              <button
                key={pkg.id}
                disabled={!fits}
                onClick={() => onSelectPackage(pkg)}
                className="text-left p-4 rounded-2xl border-2 transition-all"
                style={{
                  borderColor: isSelected ? "#D96B4C" : "#1B3A4B22",
                  background: "#fff",
                  opacity: fits ? 1 : 0.45,
                }}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-display text-base" style={{ color: "#1B3A4B" }}>{pkg.name}</span>
                    <p className="text-sm mt-0.5" style={{ color: "#3A332B99" }}>{pkg.desc}</p>
                  </div>
                  {isSelected && <Check size={18} color="#D96B4C" />}
                </div>

                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {Object.entries(pkg.items).map(([id, qty]) => {
                    const item = INVENTORY.find((i) => i.id === id);
                    if (!item) return null;
                    return (
                      <span
                        key={id}
                        className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg"
                        style={{ background: "#EDE6D6", color: "#1B3A4B" }}
                      >
                        <ItemIcon icon={item.icon} className="w-3 h-3" />
                        {qty}× {item.label}
                      </span>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <span className="font-bold text-sm" style={{ color: "#1B3A4B" }}>{currency(priceForDate(pkg.price, date))}</span>
                  <span className="text-xs line-through" style={{ color: "#3A332B66" }}>{currency(priceForDate(pkg.fullPrice, date))}</span>
                  {isWeekend(date) && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#D96B4C22", color: "#D96B4C" }}>
                      +20% weekend
                    </span>
                  )}
                  {!fits && <span className="text-xs font-semibold" style={{ color: "#D96B4C" }}>Not enough gear left today</span>}
                </div>
              </button>
            );
          })}

          {selectedPackage && (
            <div className="mt-2 rounded-2xl p-4" style={{ background: "#fff", border: "2px dashed #1B3A4B22" }}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-display text-sm" style={{ color: "#1B3A4B" }}>Add extras to {selectedPackage.name}</span>
                {addOnsTotal > 0 && (
                  <span className="text-xs font-bold" style={{ color: "#D96B4C" }}>+{currency(addOnsTotal)}</span>
                )}
              </div>
              <AddOnList
                remaining={remainingForCart}
                cart={cart}
                setQty={setQty}
                date={date}
                parOverrides={parOverrides}
                pairingActive
              />
              <p className="text-[11px] mt-2" style={{ color: "#3A332B66" }}>
                Chairs and towels are always added together, 1 for 1.
              </p>
            </div>
          )}
        </div>
      )}

      {mode === "items" && (
        <div className="flex flex-col gap-2">
          <AddOnList remaining={remainingForCart} cart={cart} setQty={setQty} date={date} parOverrides={parOverrides} />
        </div>
      )}

      {!mode && (
        <div className="text-center py-10 text-sm" style={{ color: "#3A332B66" }}>
          Pick a package for a quick start, or build your own from individual gear.
        </div>
      )}

      {cartHasItems && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4">
          {cartTotal < ORDER_MINIMUM && (
            <p className="text-center text-xs font-semibold mb-2" style={{ color: "#D96B4C" }}>
              ${ORDER_MINIMUM} minimum order — add {currency(ORDER_MINIMUM - cartTotal)} more to continue.
            </p>
          )}
          <button
            onClick={onContinue}
            disabled={cartTotal < ORDER_MINIMUM}
            className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg"
            style={{
              background: cartTotal >= ORDER_MINIMUM ? "#D96B4C" : "#1B3A4B22",
              color: cartTotal >= ORDER_MINIMUM ? "#fff" : "#3A332B66",
            }}
          >
            Continue · {currency(cartTotal)} <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// Renders item rows with qty steppers. When pairingActive is true (package add-ons), the towel
// row mirrors chairs and is shown as a linked read-only display. In à la carte mode, pairing is
// off and towels get their own independent stepper like every other item.
function AddOnList({ remaining, cart, setQty, date, parOverrides, pairingActive }) {
  return (
    <div className="flex flex-col gap-2">
      {INVENTORY.map((item) => {
        const partner = pairingActive ? PAIRED_WITH[item.id] : null;
        const left = partner
          ? Math.min(remaining[item.id] ?? 0, remaining[partner] ?? 0)
          : (remaining[item.id] ?? 0);
        const qty = cart[item.id] || 0;
        const isDerivedTowel = pairingActive && item.id === "towel";
        const displayPrice = priceForDate(item.price, date);
        const par = effectiveTotal(item.id, parOverrides);
        return (
          <div key={item.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: "#EDE6D6" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#fff" }}>
                <ItemIcon icon={item.icon} className="w-4.5 h-4.5" />
              </div>
              <div>
                <div className="font-semibold text-sm" style={{ color: "#1B3A4B" }}>
                  {item.label}
                  {isDerivedTowel && <span className="text-[10px] font-normal ml-1" style={{ color: "#3A332B66" }}>(matches chairs)</span>}
                </div>
                <div className="text-xs" style={{ color: left <= 0 ? "#D96B4C" : "#3A332B99" }}>
                  {left <= 0 ? "None left today" : `${left} of ${par} left`} · {currency(displayPrice)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isDerivedTowel ? (
                <span className="w-5 text-center font-bold text-sm" style={{ color: "#1B3A4B" }}>{qty}</span>
              ) : (
                <>
                  <QtyButton icon={<Minus size={14} />} onClick={() => setQty(item.id, qty - 1)} disabled={qty === 0} />
                  <span className="w-5 text-center font-bold text-sm" style={{ color: "#1B3A4B" }}>{qty}</span>
                  <QtyButton icon={<Plus size={14} />} onClick={() => setQty(item.id, qty + 1)} disabled={qty >= left} />
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModeButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
      style={{ background: active ? "#1B3A4B" : "#1B3A4B11", color: active ? "#EDE6D6" : "#1B3A4B" }}
    >
      {label}
    </button>
  );
}

function QtyButton({ icon, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 rounded-full flex items-center justify-center"
      style={{ background: disabled ? "#1B3A4B11" : "#1B3A4B22", color: disabled ? "#3A332B44" : "#1B3A4B" }}
    >
      {icon}
    </button>
  );
}

/* ----------------------------- step 4: liability waiver ----------------------------- */

const WAIVER_TEXT = [
  "By signing below, I agree to the following before my booking is confirmed:",
  "Assumption of risk: Beach activities carry inherent risks, including but not limited to sun exposure, water conditions, sand, wind, and the use of rented equipment. I assume full responsibility for any injury, illness, or loss that occurs during my rental period, and I release BestBeachSetUp, its owners, and its crew from liability for any such injury or loss, except where caused by gross negligence on the part of BestBeachSetUp.",
  "Equipment condition: I confirm that all equipment will be used responsibly and returned in the same condition it was delivered, ordinary wear from normal use excepted. I am responsible for any equipment that is lost, stolen, or damaged beyond normal wear while in my care, from setup until crew breakdown.",
  "Accuracy: I confirm the information I've provided for this booking is accurate, and that I am authorized to accept these terms on behalf of everyone in my group.",
];

function WaiverStep({ beach, date, waiver, onBack, onAgree }) {
  const [name, setName] = useState(waiver?.name || "");
  const [checked, setChecked] = useState(!!waiver);

  const canContinue = name.trim().length > 1 && checked;

  function handleAgree() {
    if (!canContinue) return;
    onAgree({ name: name.trim(), agreedAt: new Date().toISOString() });
  }

  return (
    <div className="px-4 pt-2 pb-28">
      <BackRow onBack={onBack} label="Gear" />
      <h1 className="font-display text-2xl mb-1 mt-2" style={{ color: "#1B3A4B" }}>Quick waiver</h1>
      <p className="text-sm mb-4" style={{ color: "#3A332B99" }}>
        {beach?.name} · {date ? formatDateLabel(date) : ""} — one signature covers your whole group.
      </p>

      <div className="rounded-2xl p-4 mb-4 flex flex-col gap-3" style={{ background: "#fff" }}>
        {WAIVER_TEXT.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed" style={{ color: i === 0 ? "#1B3A4B" : "#3A332B99" }}>
            {p}
          </p>
        ))}
      </div>

      <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff" }}>
        <label className="text-xs font-semibold mb-1.5 block" style={{ color: "#1B3A4B" }}>
          Type your full name to sign
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-3"
          style={{ background: "#EDE6D6", color: "#1B3A4B" }}
        />
        <button
          onClick={() => setChecked((c) => !c)}
          className="w-full flex items-start gap-3 text-left"
        >
          <div
            className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: checked ? "#D96B4C" : "#EDE6D6", border: checked ? "none" : "2px solid #1B3A4B33" }}
          >
            {checked && <Check size={13} color="#fff" />}
          </div>
          <span className="text-sm" style={{ color: "#3A332B99" }}>
            I have read and agree to the terms above, and my typed name is my signature.
          </span>
        </button>
      </div>

      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4">
        <button
          onClick={handleAgree}
          disabled={!canContinue}
          className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg"
          style={{ background: canContinue ? "#D96B4C" : "#1B3A4B22", color: canContinue ? "#fff" : "#3A332B66" }}
        >
          Agree &amp; continue <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- step 5: checkout (mock payment) ----------------------------- */

/* ----------------------------- step 5: checkout (Stripe) ----------------------------- */

function CheckoutStep({ beach, date, mode, selectedPackage, cart, total, onBack, onPay }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState(null);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [intentError, setIntentError] = useState(null);

  const packageContentsLabel = mode === "package"
    ? Object.entries(selectedPackage.items)
        .map(([id, qty]) => `${qty}x ${INVENTORY.find((i) => i.id === id)?.label}`)
        .join(", ")
    : null;

  const lineItems = mode === "package"
    ? [
        { label: selectedPackage.name, sub: "Package", price: priceForDate(selectedPackage.price, date), includes: packageContentsLabel },
        ...Object.entries(cart).map(([id, qty]) => {
          const item = INVENTORY.find((i) => i.id === id);
          return { label: item.label, sub: `Add-on x${qty}`, price: priceForDate(item.price, date) * qty };
        }),
      ]
    : Object.entries(cart).map(([id, qty]) => {
        const item = INVENTORY.find((i) => i.id === id);
        return { label: item.label, sub: `x${qty}`, price: priceForDate(item.price, date) * qty };
      });

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  async function handleProceedToPayment(e) {
    if (e) e.preventDefault();
    if (!validEmail(email)) { setEmailError("Please enter a valid email for your receipt."); return; }
    setEmailError(null);
    setLoadingIntent(true);
    setIntentError(null);
    try {
      const orderSummary = lineItems.map((li) => `${li.label}: ${currency(li.price)}`).join(", ");
      const res = await fetch("/api/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: total, email, beachName: beach.name, date, orderSummary }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to initialize payment");
      setClientSecret(data.clientSecret);
    } catch (err) {
      setIntentError(err.message);
    } finally {
      setLoadingIntent(false);
    }
  }

  const stripeAppearance = {
    theme: "stripe",
    variables: {
      colorPrimary: "#1B3A4B",
      colorBackground: "#EDE6D6",
      colorText: "#3A332B",
      borderRadius: "12px",
      fontFamily: "Archivo, sans-serif",
    },
  };

  return (
    <div className="px-4 pt-2 pb-10">
      <BackRow onBack={onBack} label="Waiver" />
      <h1 className="font-display text-2xl mb-1 mt-2" style={{ color: "#1B3A4B" }}>Review & pay</h1>
      <p className="text-sm mb-4" style={{ color: "#3A332B99" }}>
        {beach.name} · {formatDateLabel(date)}
        {isWeekend(date) && (
          <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#D96B4C22", color: "#D96B4C" }}>
            +20% weekend
          </span>
        )}
      </p>

      {/* Order summary */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff" }}>
        {lineItems.map((li, i) => (
          <div key={i} className="py-1.5" style={{ borderBottom: i < lineItems.length - 1 ? "1px solid #1B3A4B11" : "none" }}>
            <div className="flex justify-between text-sm">
              <span style={{ color: "#1B3A4B" }}>{li.label} <span style={{ color: "#3A332B66" }}>{li.sub}</span></span>
              <span className="font-semibold" style={{ color: "#1B3A4B" }}>{currency(li.price)}</span>
            </div>
            {li.includes && <p className="text-xs mt-0.5" style={{ color: "#3A332B66" }}>Includes: {li.includes}</p>}
          </div>
        ))}
        <div className="flex justify-between pt-3 mt-1 font-bold" style={{ borderTop: "2px solid #1B3A4B22" }}>
          <span style={{ color: "#1B3A4B" }}>Total</span>
          <span style={{ color: "#1B3A4B" }}>{currency(total)}</span>
        </div>
      </div>

      {!clientSecret ? (
        <>
          {/* Email for receipt */}
          <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff" }}>
            <div className="flex items-center gap-2 mb-3">
              <Mail size={16} color="#1B3A4B" />
              <span className="font-semibold text-sm" style={{ color: "#1B3A4B" }}>Receipt email</span>
            </div>
            <input
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
              placeholder="your@email.com"
              type="text"
              autoComplete="email"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "#EDE6D6", color: "#1B3A4B" }}
            />
            {emailError && (
              <p className="text-xs mt-2 flex items-center gap-1" style={{ color: "#D96B4C" }}>
                <AlertCircle size={12} /> {emailError}
              </p>
            )}
          </div>

          {intentError && (
            <div className="flex items-center gap-1.5 mb-3 text-sm px-3 py-2 rounded-xl" style={{ background: "#D96B4C22", color: "#D96B4C" }}>
              <AlertCircle size={14} /> {intentError}
            </div>
          )}

          <button onClick={(e) => handleProceedToPayment(e)} disabled={loadingIntent}
            className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2"
            style={{ background: "#D96B4C", color: "#fff", opacity: loadingIntent ? 0.7 : 1 }}>
            {loadingIntent ? <Loader2 className="animate-spin" size={18} /> : <CreditCard size={18} />}
            {loadingIntent ? "Setting up payment…" : `Continue to payment · ${currency(total)}`}
          </button>
        </>
      ) : (
        <Elements stripe={stripePromise} options={{ clientSecret, appearance: stripeAppearance }}>
          <StripePaymentForm
            total={total}
            email={email}
            beach={beach}
            date={date}
            onPay={onPay}
          />
        </Elements>
      )}
    </div>
  );
}

function StripePaymentForm({ total, email, beach, date, onPay }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit() {
    if (!stripe || !elements) return;
    setProcessing(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) { setError(submitError.message); setProcessing(false); return; }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}?payment=success`,
        receipt_email: email,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message);
      setProcessing(false);
    } else if (paymentIntent && paymentIntent.status === "succeeded") {
      onPay({ method: "card", last4: paymentIntent.payment_method?.toString().slice(-4) || "****", email, stripeId: paymentIntent.id });
    }
  }

  return (
    <div>
      <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff" }}>
        <div className="flex items-center gap-2 mb-3">
          <CreditCard size={16} color="#1B3A4B" />
          <span className="font-semibold text-sm" style={{ color: "#1B3A4B" }}>Payment details</span>
        </div>
        <PaymentElement options={{ layout: "tabs" }} />
        {error && (
          <div className="flex items-center gap-1.5 mt-3 text-xs font-semibold" style={{ color: "#D96B4C" }}>
            <AlertCircle size={12} /> {error}
          </div>
        )}
        <p className="text-[11px] mt-3 flex items-center gap-1" style={{ color: "#3A332B66" }}>
          <ShieldCheck size={12} /> Secured by Stripe — we never see your card details.
        </p>
      </div>

      <button onClick={handleSubmit} disabled={!stripe || processing}
        className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2"
        style={{ background: "#D96B4C", color: "#fff", opacity: (!stripe || processing) ? 0.7 : 1 }}>
        {processing ? <Loader2 className="animate-spin" size={18} /> : <CreditCard size={18} />}
        {processing ? "Processing payment…" : `Pay ${currency(total)}`}
      </button>
    </div>
  );
}

/* ----------------------------- step 5: confirmation ----------------------------- */

function ConfirmationStep({ order, onNewOrder }) {
  return (
    <div className="px-4 pt-10 flex flex-col items-center text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: "#7A9E8E" }}>
        <Check size={28} color="#fff" />
      </div>
      <h1 className="font-display text-2xl mb-1" style={{ color: "#1B3A4B" }}>Your spot is set</h1>
      <p className="text-sm mb-6 max-w-xs" style={{ color: "#3A332B99" }}>
        We'll have everything waiting at {order.beachName} on {formatDateLabel(order.date)}.
        {order.email && ` A receipt is on its way to ${order.email}.`}
      </p>

      <div className="rounded-2xl p-4 mb-4 w-full text-left" style={{ background: "#fff" }}>
        <Row label="Beach" value={order.beachName} />
        <Row label="Date" value={formatDateLabel(order.date)} />
        <Row label="Setup" value="10:00 AM" />
        <Row label="Breakdown" value="~1 hr before sunset" />
        {order.packageName && <Row label="Package" value={order.packageName} />}
        <Row label="Total paid" value={currency(order.total)} bold />
        <Row label="Confirmation" value={order.id.toUpperCase()} mono />
        {order.waiver?.name && <Row label="Waiver signed" value={order.waiver.name} />}
      </div>

      <div className="rounded-2xl p-4 mb-6 w-full text-left" style={{ background: "#fff" }}>
        <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "#3A332B66" }}>What's coming</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(order.items).map(([id, qty]) => {
            const item = INVENTORY.find((i) => i.id === id);
            if (!item) return null;
            return (
              <span key={id} className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg" style={{ background: "#EDE6D6", color: "#1B3A4B" }}>
                <ItemIcon icon={item.icon} className="w-3 h-3" />
                {qty}× {item.label}
              </span>
            );
          })}
        </div>
      </div>

      <button onClick={onNewOrder} className="text-sm font-bold" style={{ color: "#D96B4C" }}>
        Book another day →
      </button>
    </div>
  );
}

function Row({ label, value, bold, mono }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span style={{ color: "#3A332B99" }}>{label}</span>
      <span style={{ color: "#1B3A4B", fontWeight: bold ? 700 : 600, fontFamily: mono ? "monospace" : undefined }}>{value}</span>
    </div>
  );
}

/* ----------------------------- crew pin gate ----------------------------- */

function CrewPinGate({ onUnlock, onCancel }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  function handleDigit(d) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setError(false);
    setPin(next);
    if (next.length === 4) {
      if (next === CREW_PIN) {
        setTimeout(() => onUnlock(), 120);
      } else {
        setTimeout(() => {
          setError(true);
          setPin("");
        }, 250);
      }
    }
  }

  function handleBackspace() {
    setError(false);
    setPin((p) => p.slice(0, -1));
  }

  return (
    <div className="font-body max-w-md mx-auto px-4 pt-10 flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: "#1B3A4B" }}>
        <ShieldCheck size={24} color="#EDE6D6" />
      </div>
      <h1 className="font-display text-xl mb-1" style={{ color: "#1B3A4B" }}>Crew only</h1>
      <p className="text-sm mb-6" style={{ color: "#3A332B99" }}>Enter the crew PIN to see today's bookings.</p>

      <div className="flex gap-3 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-10 h-12 rounded-xl flex items-center justify-center font-display text-lg"
            style={{
              background: "#fff",
              border: error ? "2px solid #D96B4C" : "2px solid #1B3A4B22",
              color: "#1B3A4B",
            }}
          >
            {pin[i] ? "•" : ""}
          </div>
        ))}
      </div>

      {error && (
        <p className="text-xs font-semibold mb-4 flex items-center gap-1" style={{ color: "#D96B4C" }}>
          <AlertCircle size={12} /> Wrong PIN — try again.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            onClick={() => handleDigit(d)}
            className="py-3 rounded-xl font-display text-lg"
            style={{ background: "#fff", color: "#1B3A4B" }}
          >
            {d}
          </button>
        ))}
        <button onClick={onCancel} className="py-3 rounded-xl text-sm font-semibold" style={{ color: "#3A332B99" }}>
          Cancel
        </button>
        <button
          onClick={() => handleDigit("0")}
          className="py-3 rounded-xl font-display text-lg"
          style={{ background: "#fff", color: "#1B3A4B" }}
        >
          0
        </button>
        <button onClick={handleBackspace} className="py-3 rounded-xl text-sm font-semibold" style={{ color: "#3A332B99" }}>
          ⌫
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- crew view ----------------------------- */

function CrewView({ orders, onUpdateOrder }) {
  const [selectedDate, setSelectedDate] = useState(ymd(new Date()));
  const [crewTab, setCrewTab] = useState("sheet");

  const upcomingDates = useMemo(() => {
    const set = new Set(orders.map((o) => o.date));
    const today = ymd(new Date());
    set.add(today);
    return Array.from(set).sort();
  }, [orders]);

  const dayOrders = orders.filter((o) => o.date === selectedDate).sort((a, b) => a.beachName.localeCompare(b.beachName));

  const aggregatedGear = useMemo(() => {
    const totals = {};
    dayOrders.forEach((o) => {
      Object.entries(o.items).forEach(([id, qty]) => {
        totals[id] = (totals[id] || 0) + qty;
      });
    });
    return totals;
  }, [dayOrders]);

  function statusLabel(o) {
    if (o.checkoutAt) return { label: "CHECKED OUT", color: "#3A332B66" };
    if (o.checkinAt) return { label: "CHECKED IN", color: "#7A9E8E" };
    return { label: "CONFIRMED", color: "#D96B4C" };
  }

  const unreadCount = useMemo(() => {
    return orders.filter((o) => {
      const msgs = o.messages || [];
      if (!msgs.length) return false;
      return msgs[msgs.length - 1].from === "customer";
    }).length;
  }, [orders]);

  return (
    <div className="font-body max-w-md mx-auto pb-10 px-4 pt-3">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList size={18} color="#1B3A4B" />
        <h1 className="font-display text-xl" style={{ color: "#1B3A4B" }}>Crew</h1>
      </div>

      <div className="flex gap-2 mb-4">
        {[
          { id: "sheet", label: "Daily sheet" },
          { id: "messages", label: `Messages${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
        ].map((t) => (
          <button key={t.id} onClick={() => setCrewTab(t.id)}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: crewTab === t.id ? "#1B3A4B" : "#fff", color: crewTab === t.id ? "#EDE6D6" : "#1B3A4B" }}>
            {t.label}
          </button>
        ))}
      </div>

      {crewTab === "messages" && (
        <CrewMessages orders={orders} onUpdateOrder={onUpdateOrder} />
      )}

      {crewTab === "sheet" && (
        <>
          <div className="flex gap-2 overflow-x-auto mb-4 pb-1">
            {upcomingDates.map((d) => (
              <button key={d} onClick={() => setSelectedDate(d)}
                className="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
                style={{ background: selectedDate === d ? "#1B3A4B" : "#fff", color: selectedDate === d ? "#EDE6D6" : "#1B3A4B" }}>
                {formatDateLabel(d)}
              </button>
            ))}
          </div>

          {dayOrders.length === 0 ? (
            <div className="text-center py-16 text-sm" style={{ color: "#3A332B66" }}>
              No bookings for {formatDateLabel(selectedDate)}.
            </div>
          ) : (
            <>
              <div className="rounded-2xl p-4 mb-4" style={{ background: "#1B3A4B" }}>
                <div className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "#EDE6D699" }}>
                  Total gear to load — {dayOrders.length}/{MAX_BOOKINGS_PER_DAY} bookings
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(aggregatedGear).map(([id, qty]) => {
                    const item = INVENTORY.find((i) => i.id === id);
                    return (
                      <div key={id} className="flex items-center gap-1.5 text-sm" style={{ color: "#EDE6D6" }}>
                        <span className="font-bold">{qty}×</span> {item.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {dayOrders.map((o) => {
                  const st = statusLabel(o);
                  return (
                    <div key={o.id} className="rounded-2xl p-4" style={{ background: "#fff" }}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-1.5">
                          <MapPin size={14} color="#D96B4C" />
                          <span className="font-display text-sm" style={{ color: "#1B3A4B" }}>{o.beachName}</span>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#1B3A4B11", color: st.color }}>
                          {st.label}
                        </span>
                      </div>
                      <div className="text-xs mb-2" style={{ color: "#3A332B99" }}>
                        Setup 10:00 AM · Breakdown ~1 hr before sunset
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {Object.entries(o.items).map(([id, qty]) => {
                          const item = INVENTORY.find((i) => i.id === id);
                          return (
                            <span key={id} className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ background: "#EDE6D6", color: "#1B3A4B" }}>
                              {qty}× {item.label}
                            </span>
                          );
                        })}
                      </div>
                      <div className="text-[11px] font-mono mb-1" style={{ color: "#3A332B66" }}>
                        #{o.id.toUpperCase()} · {currency(o.total)} paid
                      </div>
                      <div className="text-[11px] mb-2 flex items-center gap-1" style={{ color: o.waiver?.name ? "#7A9E8E" : "#D96B4C" }}>
                        {o.waiver?.name ? <Check size={11} /> : <AlertCircle size={11} />}
                        {o.waiver?.name ? `Waiver: ${o.waiver.name}` : "No waiver on file"}
                      </div>
                      {!o.checkinAt && !o.checkoutAt && (
                        <button onClick={() => onUpdateOrder(o.id, { checkinAt: new Date().toISOString(), status: "checked-in" })}
                          className="w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                          style={{ background: "#7A9E8E22", color: "#7A9E8E" }}>
                          <LogIn size={13} /> Mark checked in
                        </button>
                      )}
                      {o.checkinAt && !o.checkoutAt && (
                        <div className="flex flex-col gap-1.5">
                          <div className="text-[11px] flex items-center gap-1" style={{ color: "#7A9E8E" }}>
                            <Check size={11} /> Checked in {new Date(o.checkinAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                          <button onClick={() => onUpdateOrder(o.id, { checkoutAt: new Date().toISOString(), status: "checked-out" })}
                            className="w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                            style={{ background: "#D96B4C22", color: "#D96B4C" }}>
                            <LogOut size={13} /> Mark checked out
                          </button>
                        </div>
                      )}
                      {o.checkoutAt && (
                        <div className="text-[11px] flex items-center gap-1" style={{ color: "#3A332B66" }}>
                          <Check size={11} /> Checked out {new Date(o.checkoutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ----------------------------- crew messages ----------------------------- */

function CrewMessages({ orders, onUpdateOrder }) {
  const [activeOrderId, setActiveOrderId] = useState(null);
  const [replyText, setReplyText] = useState("");

  const threads = orders.filter((o) => (o.messages || []).length > 0)
    .sort((a, b) => {
      const aLast = a.messages[a.messages.length - 1]?.sentAt || "";
      const bLast = b.messages[b.messages.length - 1]?.sentAt || "";
      return bLast.localeCompare(aLast);
    });

  const activeOrder = orders.find((o) => o.id === activeOrderId) || null;

  function sendReply() {
    if (!replyText.trim() || !activeOrder) return;
    const msg = { text: replyText.trim(), from: "crew", sentAt: new Date().toISOString() };
    onUpdateOrder(activeOrder.id, { messages: [...(activeOrder.messages || []), msg] });
    setReplyText("");
  }

  if (activeOrder) {
    const hasUnread = (activeOrder.messages || []).length > 0 &&
      activeOrder.messages[activeOrder.messages.length - 1].from === "customer";
    return (
      <div>
        <button onClick={() => setActiveOrderId(null)}
          className="flex items-center gap-1 text-sm font-semibold mb-3" style={{ color: "#D96B4C" }}>
          <ChevronLeft size={16} /> All messages
        </button>
        <div className="rounded-2xl p-3 mb-3" style={{ background: "#1B3A4B" }}>
          <div className="text-xs font-bold" style={{ color: "#EDE6D6" }}>{activeOrder.beachName} · {formatDateLabel(activeOrder.date)}</div>
          <div className="text-[11px] font-mono" style={{ color: "#EDE6D699" }}>#{activeOrder.id.toUpperCase()}</div>
        </div>
        <div className="rounded-2xl p-3 mb-3 flex flex-col gap-2" style={{ background: "#fff", minHeight: "180px" }}>
          {(activeOrder.messages || []).map((m, i) => (
            <div key={i} className={`flex ${m.from === "crew" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[80%] px-3 py-2 rounded-2xl text-sm"
                style={{ background: m.from === "crew" ? "#D96B4C" : "#EDE6D6", color: m.from === "crew" ? "#fff" : "#1B3A4B" }}>
                {m.text}
                <div className="text-[10px] mt-0.5 opacity-60">
                  {new Date(m.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={replyText} onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type a reply…"
            className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: "#fff", color: "#1B3A4B" }} />
          <button onClick={sendReply}
            className="px-4 py-2.5 rounded-xl font-bold text-sm"
            style={{ background: "#D96B4C", color: "#fff" }}>
            Send
          </button>
        </div>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="text-center py-16 text-sm" style={{ color: "#3A332B66" }}>
        No messages yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {threads.map((o) => {
        const msgs = o.messages || [];
        const last = msgs[msgs.length - 1];
        const unread = last?.from === "customer";
        return (
          <button key={o.id} onClick={() => setActiveOrderId(o.id)}
            className="w-full text-left rounded-2xl p-4"
            style={{ background: "#fff", border: unread ? "2px solid #D96B4C" : "2px solid transparent" }}>
            <div className="flex justify-between items-start mb-1">
              <div className="font-semibold text-sm" style={{ color: "#1B3A4B" }}>
                {o.beachName} · {formatDateLabel(o.date)}
              </div>
              {unread && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "#D96B4C", color: "#fff" }}>
                  NEW
                </span>
              )}
            </div>
            <div className="text-xs truncate" style={{ color: "#3A332B99" }}>
              {last?.from === "crew" ? "You: " : "Customer: "}{last?.text}
            </div>
            <div className="text-[11px] font-mono mt-1" style={{ color: "#3A332B66" }}>
              #{o.id.toUpperCase()} · {msgs.length} message{msgs.length !== 1 ? "s" : ""}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- crew inventory view ----------------------------- */

function CrewInventoryView({ parOverrides, onSetPar, onResetPar }) {
  const overrideCount = Object.keys(parOverrides || {}).length;

  function adjust(itemId, defaultTotal, delta) {
    const current = effectiveTotal(itemId, parOverrides);
    const next = Math.max(0, current + delta);
    if (next === defaultTotal) {
      onResetPar(itemId);
    } else {
      onSetPar(itemId, next);
    }
  }

  return (
    <div className="font-body max-w-md mx-auto pb-10 px-4 pt-3">
      <div className="flex items-center gap-2 mb-1">
        <Settings2 size={18} color="#1B3A4B" />
        <h1 className="font-display text-xl" style={{ color: "#1B3A4B" }}>Daily inventory</h1>
      </div>
      <p className="text-sm mb-4" style={{ color: "#3A332B99" }}>
        Adjust how much of each item is actually available — gear in the shop, lost, or added.
        Changes apply going forward across both beaches until you change them again.
      </p>

      {overrideCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-semibold mb-4 px-3 py-2 rounded-xl" style={{ background: "#D96B4C22", color: "#D96B4C" }}>
          <AlertCircle size={13} /> {overrideCount} item{overrideCount > 1 ? "s" : ""} adjusted from default.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {INVENTORY.map((item) => {
          const par = effectiveTotal(item.id, parOverrides);
          const isOverridden = par !== item.total;
          return (
            <div key={item.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: "#fff" }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#EDE6D6" }}>
                  <ItemIcon icon={item.icon} className="w-4.5 h-4.5" />
                </div>
                <div>
                  <div className="font-semibold text-sm" style={{ color: "#1B3A4B" }}>{item.label}</div>
                  <div className="text-xs" style={{ color: isOverridden ? "#D96B4C" : "#3A332B99" }}>
                    {isOverridden ? `Default ${item.total} · ` : ""}{currency(item.price)}/day
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <QtyButton icon={<Minus size={14} />} onClick={() => adjust(item.id, item.total, -1)} disabled={par <= 0} />
                <span className="w-7 text-center font-bold text-sm" style={{ color: isOverridden ? "#D96B4C" : "#1B3A4B" }}>{par}</span>
                <QtyButton icon={<Plus size={14} />} onClick={() => adjust(item.id, item.total, 1)} disabled={false} />
                {isOverridden && (
                  <button
                    onClick={() => onResetPar(item.id)}
                    className="w-7 h-7 rounded-full flex items-center justify-center ml-1"
                    style={{ background: "#1B3A4B11", color: "#1B3A4B" }}
                    title={`Reset to default (${item.total})`}
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- my booking view ----------------------------- */

function MyBookingView({ order, orders, onUpdateOrder, onSelectOrder, onNewBooking }) {
  const [lookupCode, setLookupCode] = useState("");
  const [lookupError, setLookupError] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [messageSent, setMessageSent] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState(null); // null | "confirming" | "done"
  const [itemsConfirmed, setItemsConfirmed] = useState({});

  function handleLookup() {
    const found = orders.find((o) => o.id.toUpperCase() === lookupCode.trim().toUpperCase());
    if (found) {
      onSelectOrder(found.id);
      setLookupCode("");
      setLookupError(false);
    } else {
      setLookupError(true);
    }
  }

  function handleSendMessage() {
    if (!messageText.trim() || !order) return;
    const msg = { text: messageText.trim(), from: "customer", sentAt: new Date().toISOString() };
    onUpdateOrder(order.id, { messages: [...(order.messages || []), msg] });
    setMessageText("");
    setMessageSent(true);
    setTimeout(() => setMessageSent(false), 3000);
  }

  function handleCheckin() {
    onUpdateOrder(order.id, { checkinAt: new Date().toISOString(), status: "checked-in" });
  }

  function startCheckout() {
    setItemsConfirmed({});
    setCheckoutStep("confirming");
  }

  function toggleItem(id) {
    setItemsConfirmed((c) => ({ ...c, [id]: !c[id] }));
  }

  function finishCheckout() {
    onUpdateOrder(order.id, {
      checkoutAt: new Date().toISOString(),
      status: "checked-out",
      checkoutItems: itemsConfirmed,
    });
    setCheckoutStep("done");
  }

  // Lookup screen — shown when no order is active
  if (!order) {
    return (
      <div className="font-body max-w-md mx-auto px-4 pt-8">
        <div className="flex items-center gap-2 mb-1">
          <Search size={18} color="#1B3A4B" />
          <h1 className="font-display text-xl" style={{ color: "#1B3A4B" }}>My Booking</h1>
        </div>
        <p className="text-sm mb-6" style={{ color: "#3A332B99" }}>
          Enter your confirmation number to pull up your booking page.
        </p>
        <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff" }}>
          <input
            value={lookupCode}
            onChange={(e) => { setLookupCode(e.target.value.toUpperCase()); setLookupError(false); }}
            placeholder="Confirmation number"
            className="w-full px-3 py-3 rounded-xl text-sm font-mono outline-none mb-3"
            style={{ background: "#EDE6D6", color: "#1B3A4B" }}
          />
          {lookupError && (
            <p className="text-xs flex items-center gap-1 mb-2" style={{ color: "#D96B4C" }}>
              <AlertCircle size={12} /> That confirmation number doesn't match any booking.
            </p>
          )}
          <button onClick={handleLookup}
            className="w-full py-3 rounded-xl font-bold text-sm"
            style={{ background: "#1B3A4B", color: "#EDE6D6" }}>
            Look up booking
          </button>
        </div>
        <button onClick={onNewBooking} className="w-full text-center text-sm font-semibold py-2" style={{ color: "#D96B4C" }}>
          No booking yet? Reserve your spot →
        </button>
      </div>
    );
  }

  // Item-by-item checkout confirmation overlay
  if (checkoutStep === "confirming") {
    const allConfirmed = Object.keys(order.items).every((id) => itemsConfirmed[id]);
    return (
      <div className="font-body max-w-md mx-auto px-4 pt-4 pb-10">
        <h1 className="font-display text-xl mb-1" style={{ color: "#1B3A4B" }}>Confirm your gear</h1>
        <p className="text-sm mb-4" style={{ color: "#3A332B99" }}>
          Check off each item to confirm you still have everything before breakdown.
        </p>
        <div className="flex flex-col gap-2 mb-6">
          {Object.entries(order.items).map(([id, qty]) => {
            const item = INVENTORY.find((i) => i.id === id);
            if (!item) return null;
            const confirmed = !!itemsConfirmed[id];
            return (
              <button key={id} onClick={() => toggleItem(id)}
                className="flex items-center gap-3 p-3 rounded-xl text-left"
                style={{ background: confirmed ? "#7A9E8E22" : "#fff", border: `2px solid ${confirmed ? "#7A9E8E" : "#1B3A4B11"}` }}>
                <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ background: confirmed ? "#7A9E8E" : "#EDE6D6" }}>
                  {confirmed && <Check size={14} color="#fff" />}
                </div>
                <div>
                  <div className="font-semibold text-sm" style={{ color: "#1B3A4B" }}>{qty}× {item.label}</div>
                </div>
              </button>
            );
          })}
        </div>
        <button onClick={finishCheckout} disabled={!allConfirmed}
          className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 mb-3"
          style={{ background: allConfirmed ? "#D96B4C" : "#1B3A4B22", color: allConfirmed ? "#fff" : "#3A332B66" }}>
          <LogOut size={16} /> All accounted for — check out
        </button>
        <button onClick={() => setCheckoutStep(null)} className="w-full text-center text-sm" style={{ color: "#3A332B99" }}>
          Cancel
        </button>
      </div>
    );
  }

  // Main booking page
  const statusInfo = order.checkoutAt
    ? { label: "Checked out", color: "#3A332B66", icon: <LogOut size={14} /> }
    : order.checkinAt
    ? { label: "Checked in", color: "#7A9E8E", icon: <LogIn size={14} /> }
    : { label: "Confirmed", color: "#D96B4C", icon: <Check size={14} /> };

  return (
    <div className="font-body max-w-md mx-auto px-4 pt-4 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-xl" style={{ color: "#1B3A4B" }}>{order.beachName}</h1>
          <p className="text-sm" style={{ color: "#3A332B99" }}>{formatDateLabel(order.date)}</p>
        </div>
        <div className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full"
          style={{ background: "#1B3A4B11", color: statusInfo.color }}>
          {statusInfo.icon}
          <span className="ml-1">{statusInfo.label}</span>
        </div>
      </div>

      {/* Order summary */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff" }}>
        <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "#3A332B66" }}>Your gear</div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {Object.entries(order.items).map(([id, qty]) => {
            const item = INVENTORY.find((i) => i.id === id);
            if (!item) return null;
            return (
              <span key={id} className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg"
                style={{ background: "#EDE6D6", color: "#1B3A4B" }}>
                <ItemIcon icon={item.icon} className="w-3 h-3" />
                {qty}× {item.label}
              </span>
            );
          })}
        </div>
        <div style={{ borderTop: "1px solid #1B3A4B11", paddingTop: "10px" }}>
          <Row label="Setup" value="10:00 AM" />
          <Row label="Breakdown" value="~1 hr before sunset" />
          <Row label="Total paid" value={currency(order.total)} bold />
          <Row label="Confirmation" value={order.id.toUpperCase()} mono />
          {order.email && <Row label="Receipt sent to" value={order.email} />}
        </div>
      </div>

      {/* Check-in / Check-out */}
      {!order.checkinAt && !order.checkoutAt && (
        <button onClick={handleCheckin}
          className="w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 mb-4"
          style={{ background: "#7A9E8E", color: "#fff" }}>
          <LogIn size={18} /> Check in — we're here!
        </button>
      )}
      {order.checkinAt && !order.checkoutAt && (
        <div className="mb-4">
          <div className="text-xs font-semibold flex items-center gap-1 mb-2" style={{ color: "#7A9E8E" }}>
            <Check size={12} /> Checked in at {new Date(order.checkinAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          {checkoutStep !== "done" && (
            <button onClick={startCheckout}
              className="w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2"
              style={{ background: "#1B3A4B", color: "#EDE6D6" }}>
              <LogOut size={18} /> Ready to check out
            </button>
          )}
        </div>
      )}
      {order.checkoutAt && (
        <div className="rounded-2xl p-4 mb-4" style={{ background: "#1B3A4B" }}>
          <div className="flex items-center gap-2 text-sm font-bold mb-1" style={{ color: "#EDE6D6" }}>
            <Check size={16} /> All done — see you next time!
          </div>
          <p className="text-xs" style={{ color: "#EDE6D699" }}>
            Checked out at {new Date(order.checkoutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Crew is on their way to break everything down.
          </p>
        </div>
      )}

      {/* Messaging */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff" }}>
        <div className="flex items-center gap-2 mb-3">
          <MessageCircle size={16} color="#1B3A4B" />
          <span className="font-semibold text-sm" style={{ color: "#1B3A4B" }}>Message BestBeachSetUp</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto" style={{ background: "#7A9E8E33", color: "#1B3A4B" }}>DEMO MODE</span>
        </div>
        {(order.messages || []).length > 0 && (
          <div className="flex flex-col gap-2 mb-3">
            {order.messages.map((m, i) => (
              <div key={i} className={`flex ${m.from === "customer" ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[80%] px-3 py-2 rounded-2xl text-sm"
                  style={{
                    background: m.from === "customer" ? "#1B3A4B" : "#EDE6D6",
                    color: m.from === "customer" ? "#EDE6D6" : "#1B3A4B",
                  }}>
                  {m.text}
                </div>
              </div>
            ))}
            {messageSent && (
              <div className="flex justify-end">
                <div className="text-xs px-2" style={{ color: "#3A332B66" }}>Sent — BestBeachSetUp will reply soon.</div>
              </div>
            )}
          </div>
        )}
        {(order.messages || []).length === 0 && (
          <p className="text-xs mb-3" style={{ color: "#3A332B99" }}>
            Questions about your setup? Send us a message.
          </p>
        )}
        <div className="flex gap-2">
          <input value={messageText} onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: "#EDE6D6", color: "#1B3A4B" }} />
          <button onClick={handleSendMessage}
            className="px-4 py-2.5 rounded-xl font-bold text-sm"
            style={{ background: "#1B3A4B", color: "#EDE6D6" }}>
            Send
          </button>
        </div>
        <p className="text-[11px] mt-2" style={{ color: "#3A332B66" }}>
          Messages are mocked — no real notifications sent in demo mode.
        </p>
      </div>

      <button onClick={() => onSelectOrder(null)} className="w-full text-center text-sm font-semibold py-2" style={{ color: "#3A332B99" }}>
        Look up a different booking
      </button>
    </div>
  );
}

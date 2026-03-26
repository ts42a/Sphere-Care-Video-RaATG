import { View, Text, Pressable, StyleSheet } from "react-native";

type BookingCalendarProps = {
  visibleMonth: Date;
  availableDates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  minDate: string;
  maxDate: string;
};

const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameMonth(date: Date, visibleMonth: Date) {
  return (
    date.getFullYear() === visibleMonth.getFullYear() &&
    date.getMonth() === visibleMonth.getMonth()
  );
}

function buildCalendarDays(visibleMonth: Date) {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const startDay = firstDayOfMonth.getDay();

  const gridStart = new Date(year, month, 1 - startDay);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    days.push(date);
  }

  return days;
}

function compareDateStrings(a: string, b: string) {
  return new Date(a).getTime() - new Date(b).getTime();
}

export default function BookingCalendar({
  visibleMonth,
  availableDates,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  minDate,
  maxDate,
}: BookingCalendarProps) {
  const days = buildCalendarDays(visibleMonth);

  const availableSet = new Set(availableDates);

  function isWithinRange(dateKey: string) {
    return (
      compareDateStrings(dateKey, minDate) >= 0 &&
      compareDateStrings(dateKey, maxDate) <= 0
    );
  }

  return (
    <View>
      <View style={styles.header}>
        <Pressable onPress={onPrevMonth} style={styles.arrowBtn}>
          <Text style={styles.arrowText}>{"<"}</Text>
        </Pressable>

        <Text style={styles.monthText}>
          {visibleMonth.toLocaleDateString("en-AU", {
            month: "long",
            year: "numeric",
          })}
        </Text>

        <Pressable onPress={onNextMonth} style={styles.arrowBtn}>
          <Text style={styles.arrowText}>{">"}</Text>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {weekDays.map((day) => (
          <Text key={day} style={styles.weekDay}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((date) => {
          const dateKey = toDateKey(date);
          const inMonth = isSameMonth(date, visibleMonth);
          const inRange = isWithinRange(dateKey);
          const isAvailable = availableSet.has(dateKey);
          const isSelected = selectedDate === dateKey;
          const disabled = !inMonth || !inRange || !isAvailable;

          return (
            <Pressable
              key={dateKey}
              style={[
                styles.dayCell,
                isSelected && styles.dayCellSelected,
              ]}
              disabled={disabled}
              onPress={() => onSelectDate(dateKey)}
            >
              <Text
                style={[
                  styles.dayText,
                  !inMonth && styles.dayTextOutsideMonth,
                  disabled && styles.dayTextDisabled,
                  isSelected && styles.dayTextSelected,
                ]}
              >
                {date.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  arrowBtn: {
    width: 34,
    height: 34,
    justifyContent: "center",
    alignItems: "center",
  },
  arrowText: {
    fontSize: 24,
    color: "#4D5C6D",
    fontWeight: "600",
  },
  monthText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1D2740",
  },
  weekRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  weekDay: {
    width: "14.28%",
    textAlign: "center",
    fontSize: 15,
    color: "#6A7487",
    fontWeight: "500",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 28,
  },
  dayCell: {
    width: "14.28%",
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
  },
  dayCellSelected: {
    backgroundColor: "#121D3A",
  },
  dayText: {
    fontSize: 16,
    color: "#1D2740",
  },
  dayTextOutsideMonth: {
    color: "#C7CED8",
  },
  dayTextDisabled: {
    color: "#D3D9E1",
  },
  dayTextSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});